import { extendConfig, task, types } from "hardhat/config";
// import { lazyObject } from "hardhat/plugins";

import "@openzeppelin/hardhat-upgrades";
import {
  HardhatConfig,
  HardhatUserConfig,
  UpgradeManagerContractConfig,
} from "hardhat/types";
import { deploy } from "./deploy";
import { reportProtocolStatus } from "./status";
import { upgrade } from "./upgrade";

// import { ExampleHardhatRuntimeEnvironmentField } from "./ExampleHardhatRuntimeEnvironmentField";
// This import is needed to let the TypeScript compiler know that it should include your type
// extensions in your npm package's types file.

import { HardhatPluginError } from "hardhat/plugins";
import "./type-extensions";
import { DeployConfig, DeployConfigInput } from "./types";
import { describeNetwork, getDeployAddress, log, PLUGIN_NAME } from "./util";
import { diff } from "./diff";

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
          };
        } else {
          if (config.deterministic && !config.abstract) {
            throw new HardhatPluginError(
              PLUGIN_NAME,
              `Contract ${config.id} is deterministic but not abstract - only both or neither are currently supported`
            );
          }
          return {
            abstract: false,
            deterministic: false,
            contract: config.id,
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
  cb: (deployConfig: DeployConfig, params: TaskParams) => Promise<unknown>
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

      let deployAddress: string = await getDeployAddress(deployConfigInput);

      let deployConfig = {
        ...deployConfigInput,
        deployAddress,
      };

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
  reportProtocolStatus
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
  (config: DeployConfig, { contractId, compare }) => {
    if (compare != "local" && compare != "proposed") {
      throw new HardhatPluginError(
        PLUGIN_NAME,
        "only local or proposed supported for compare argument"
      );
    }
    return diff(config, contractId, compare);
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
