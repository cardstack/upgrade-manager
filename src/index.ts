import "@openzeppelin/hardhat-upgrades";
import { AddressOne } from "@gnosis.pm/safe-contracts";
import { getAddress } from "ethers/lib/utils";
import { extendConfig, task, types } from "hardhat/config";
import { HardhatPluginError } from "hardhat/plugins";
import {
  HardhatConfig,
  HardhatUserConfig,
  UpgradeManagerContractConfig,
} from "hardhat/types";

import { deploy } from "./deploy";
import { addProposer, removeProposer } from "./proposers";
import {
  addSafeOwner,
  decodePriorSignatures,
  removeSafeOwner,
  safeOwnership,
  setSafeThreshold,
} from "./safe";
import { reportProtocolStatus } from "./status";
import { DeployConfig, DeployConfigInput } from "./types";
// eslint-disable-next-line import/order
import { upgrade } from "./upgrade"; // lint rule is bugged for this line for some reason

// import { diff } from "./diff";
// import { lazyObject } from "hardhat/plugins";
// import { ExampleHardhatRuntimeEnvironmentField } from "./ExampleHardhatRuntimeEnvironmentField";
// This import is needed to let the TypeScript compiler know that it should include your type
// extensions in your npm package's types file.

import "./type-extensions";
import { describeNetwork, getDeployAddress, log, PLUGIN_NAME } from "./util";
import { withdrawAllAbstractProposals } from "./withdraw-proposed-changes";

extendConfig(
  (config: HardhatConfig, userConfig: Readonly<HardhatUserConfig>) => {
    const contracts = (userConfig.upgradeManager?.contracts || []).map(
      (config): UpgradeManagerContractConfig => {
        if (typeof config == "string") {
          return {
            id: config,
            contract: config,
            abstract: false,
            deterministic: false,
            constructorArgs: [],
          };
        } else {
          if (config.deterministic && !config.abstract) {
            throw new HardhatPluginError(
              PLUGIN_NAME,
              `Contract ${config.id} is deterministic but not abstract - only both or neither are currently supported`
            );
          }

          if (config.constructorArgs && !config.abstract) {
            throw new HardhatPluginError(
              PLUGIN_NAME,
              `Contract ${config.id} has constructorArgs but is not abstract, this is not supported`
            );
          }

          return {
            abstract: false,
            deterministic: false,
            contract: config.id,
            constructorArgs: [],
            ...config,
          };
        }
      }
    );

    let seenIds: { [id: string]: true } = {};
    contracts.forEach((c) => {
      if (seenIds[c.id]) {
        throw new HardhatPluginError(
          PLUGIN_NAME,
          `Duplicate contract id ${c.id}`
        );
      }

      seenIds[c.id] = true;
    });
    config.upgradeManager = { contracts };
  }
);

type TaskParams = {
  deployNetwork: string;
  fork: string;
  dryRun: boolean;
  mnemonic: string;
  impersonateAddress?: string;
  derivationPath?: string;
  autoConfirm: boolean;
  newVersion: string;
  quiet: boolean;
  contractId: string;
  compare: string;
  immediateConfigApply: boolean;
  proposerAddress: string;
  newSafeOwners: string;
  newSafeThreshold?: number;
  gnosisSafeMasterCopy: string;
  newSafeOwnerAddress: string;
  removeSafeOwnerAddress: string;
  priorSignatures: string;
};

function deployTask(
  taskName: string,
  taskDescription: string,
  cb: (deployConfig: DeployConfig, params: TaskParams) => Promise<unknown>,
  options = { readOnly: false }
) {
  return task(taskName, taskDescription)
    .addOptionalParam("fork", "The network to fork", undefined, types.string)
    .addOptionalParam(
      "derivationPath",
      "Derivation path to use when using mnemonic or trezor",
      undefined,
      types.string
    )
    .addOptionalParam(
      "impersonateAddress",
      "Address to impersonate deploying from (usually only makes sense whilst forking)",
      undefined,
      types.string
    )
    .addOptionalParam(
      "autoConfirm",
      "Don't ask for confirmation, useful in scripts / tests",
      false,
      types.boolean
    )
    .addOptionalParam(
      "priorSignatures",
      "Prior safe signatures collected for this operation",
      undefined,
      types.string
    )
    .addOptionalParam(
      "mnemonic",
      "Mnemonic to use for deploy actions",
      undefined,
      types.string
    )
    .setAction(async (params, hre) => {
      let {
        fork,
        dryRun,
        impersonateAddress,
        derivationPath,
        autoConfirm,
        immediateConfigApply,
        priorSignatures,
        mnemonic,
      }: TaskParams = params;
      // network is the "source" - the current blockchain
      // state to use - if not forking, it's also the destination, forking
      // the destination would be localhost or hardhat depending on if
      // there's a seperate hardhat node running on localhost

      if (fork && !impersonateAddress) {
        throw new HardhatPluginError(
          PLUGIN_NAME,
          "--impersonate-address param is required when forking"
        );
      } else if (
        !fork &&
        impersonateAddress &&
        hre.network.name !== "hardhat"
      ) {
        throw new HardhatPluginError(
          PLUGIN_NAME,
          "--impersonate-address only makes sense when forking or otherwise using hardhat network"
        );
      }

      if (impersonateAddress) {
        // Ensure address is checksummed
        impersonateAddress = getAddress(impersonateAddress);
      }

      await hre.run("compile");

      let sourceNetwork = fork || hre.network.name;

      let deployConfigInput: DeployConfigInput = {
        hre,
        network: hre.network.name,
        sourceNetwork,
        forking: !!fork,
        deployAddress: impersonateAddress,
        dryRun,
        derivationPath,
        autoConfirm,
        immediateConfigApply,
        mnemonic,
        priorSignatures: decodePriorSignatures(priorSignatures),
      };

      log("Deploying to", describeNetwork(deployConfigInput));

      let deployAddress: string = await getDeployAddress(
        deployConfigInput,
        options.readOnly
      );

      let deployConfig = {
        ...deployConfigInput,
        deployAddress,
      };

      // Don't reset localhost, assume it's a node run with `npx hardhat node --fork $RPC_URL`
      if (deployConfig.forking && hre.network.name != "localhost") {
        let networkConfig = hre.config.networks[deployConfig.sourceNetwork];
        if (!("url" in networkConfig) || !networkConfig.url) {
          throw new HardhatPluginError(
            PLUGIN_NAME,
            `Could not find RPC url for ${deployConfig.sourceNetwork} to fork`
          );
        }

        await hre.network.provider.request({
          method: "hardhat_reset",
          params: [
            {
              forking: {
                jsonRpcUrl: networkConfig.url,
              },
            },
          ],
        });
      }

      return await cb(deployConfig, params);
    });
}

deployTask(
  "deploy",
  "Deploys new contracts and propose implementation and config changes for existing deployed contracts",
  deploy
)
  .addOptionalParam(
    "immediateConfigApply",
    `If there are a large series of calls e.g. during initial setup, apply config immediately by calling methods directly on contracts instead of proposing config changes`,
    false,
    types.boolean
  )
  .addOptionalParam(
    "dryRun",
    "Preview what would happen, without actually writing to the blockchain",
    false,
    types.boolean
  );

deployTask(
  "deploy:status",
  "Shows current deploy status",
  reportProtocolStatus,
  { readOnly: true }
).addOptionalParam(
  "quiet",
  "Don't exit with status 1 if changes are detected, used in tests",
  false,
  types.boolean
);

deployTask(
  "deploy:upgrade",
  "Applies pending contract upgrades and config changes atomically",
  (config: DeployConfig, { newVersion }) => upgrade(config, newVersion)
).addPositionalParam(
  "newVersion",
  "The new version number to set on the upgrade manager. Does not have to increase or change",
  undefined,
  types.string,
  false
);

deployTask(
  "deploy:withdraw-abstract-proposals",
  "Withdraw ALL abstract proposals",
  (config: DeployConfig) => withdrawAllAbstractProposals(config)
);

deployTask(
  "deploy:add-proposer",
  "Adds a proposer",
  (config: DeployConfig, { proposerAddress }) =>
    addProposer(config, proposerAddress)
).addPositionalParam(
  "proposerAddress",
  "The proposer address to add",
  undefined,
  types.string,
  false
);
deployTask(
  "deploy:remove-proposer",
  "Removes a proposer",
  (config: DeployConfig, { proposerAddress }) =>
    removeProposer(config, proposerAddress)
).addPositionalParam(
  "proposerAddress",
  "The proposer address to remove",
  undefined,
  types.string,
  false
);

deployTask(
  "deploy:safe-setup",
  "Setup a new Gnosis Safe contract and transfer the ownership of the upgrade manager to the new safe",
  async (deployConfig, { newSafeOwners, newSafeThreshold }) => {
    if (!newSafeThreshold) {
      throw new HardhatPluginError(PLUGIN_NAME, "newSafeThreshold is required");
    }
    await safeOwnership(deployConfig, {
      newSafeOwners: newSafeOwners.split(","),
      newSafeThreshold,
    });
  }
)
  .addPositionalParam(
    "newSafeOwners",
    "The new owners of the safe, comma seperated addresses",
    undefined,
    types.string,
    false
  )
  .addPositionalParam(
    "newSafeThreshold",
    "The new threshold for the safe",
    1,
    types.int
  );

deployTask(
  "deploy:add-safe-owner",
  "Adds a safe owner",
  (config: DeployConfig, { newSafeOwnerAddress, newSafeThreshold }) =>
    addSafeOwner(config, newSafeOwnerAddress, newSafeThreshold)
)
  .addPositionalParam(
    "newSafeOwnerAddress",
    "The safe owner address to add",
    undefined,
    types.string,
    false
  )
  .addOptionalParam(
    "newSafeThreshold",
    "The new threshold for the safe, if it changes",
    undefined,
    types.int
  );

deployTask(
  "deploy:remove-safe-owner",
  "Removes a safe owner",
  (config: DeployConfig, { removeSafeOwnerAddress, newSafeThreshold }) =>
    removeSafeOwner(config, removeSafeOwnerAddress, newSafeThreshold)
)
  .addPositionalParam(
    "removeSafeOwnerAddress",
    "The safe owner address to remove",
    undefined,
    types.string,
    false
  )
  .addOptionalParam(
    "newSafeThreshold",
    "The new threshold for the safe, if it changes",
    undefined,
    types.int
  );

deployTask(
  "deploy:set-safe-threshold",
  "Sets the threshold for a safe",
  (config: DeployConfig, { newSafeThreshold }) => {
    if (!newSafeThreshold) {
      throw new HardhatPluginError(PLUGIN_NAME, "Threshold must be provided");
    }
    return setSafeThreshold(config, newSafeThreshold);
  }
).addPositionalParam(
  "newSafeThreshold",
  "The new threshold for the safe",
  undefined,
  types.int,
  false
);

AddressOne;
