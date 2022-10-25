import { getAddress } from "ethers/lib/utils";
import { extendConfig, task, types } from "hardhat/config";
import "@openzeppelin/hardhat-upgrades";
import { HardhatPluginError } from "hardhat/plugins";
import {
  HardhatConfig,
  HardhatUserConfig,
  UpgradeManagerContractConfig,
} from "hardhat/types";

import { deploy } from "./deploy";
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
  impersonateAddress?: string;
  derivationPath?: string;
  autoConfirm: boolean;
  newVersion: string;
  quiet: boolean;
  contractId: string;
  compare: string;
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
      "dryRun",
      "Preview what would happen, without actually writing to the blockchain",
      false,
      types.boolean
    )
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
    .setAction(async (params, hre) => {
      let {
        fork,
        dryRun,
        impersonateAddress,
        derivationPath,
        autoConfirm,
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
      } else if (!fork && impersonateAddress) {
        throw new HardhatPluginError(
          PLUGIN_NAME,
          "--impersonate-address only makes sense when forking"
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
        mnemonic: process.env.DEPLOY_MNEMONIC,
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
                // TODO
                // blockNumber: 123
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
  "deploy:diff:local",
  "Shows the diff between local contract code and on-chain code",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (config: DeployConfig, { contractId, compare }) => {
    if (compare != "local" && compare != "proposed") {
      throw new HardhatPluginError(
        PLUGIN_NAME,
        "only local or proposed supported for compare argument"
      );
    }
    throw new Error("TODO");
    // return diff(config, contractId, compare);
  }
)
  .addPositionalParam(
    "contractId",
    "The contract id to compare code",
    undefined,
    types.string,
    false
  )
  .addPositionalParam(
    "compare",
    "choose whether to compare local changes with active on-chain code, or proposed changes",
    "local",
    types.string,
    true
  );
