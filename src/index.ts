import { extendConfig, task, types } from "hardhat/config";
// import { lazyObject } from "hardhat/plugins";
import {
  HardhatConfig,
  HardhatUserConfig,
  UpgradeManagerContractConfig,
} from "hardhat/types";
import { deploy } from "./deploy";
import { execute } from "./execute";

// import { ExampleHardhatRuntimeEnvironmentField } from "./ExampleHardhatRuntimeEnvironmentField";
// This import is needed to let the TypeScript compiler know that it should include your type
// extensions in your npm package's types file.

import "./type-extensions";
import { DeployConfig } from "./types";
import { getDeployAddress, log } from "./util";

extendConfig(
  (config: HardhatConfig, userConfig: Readonly<HardhatUserConfig>) => {
    const contracts = (userConfig.upgradeManager?.contracts || []).map(
      (config): UpgradeManagerContractConfig => {
        if (typeof config == "string") {
          return {
            id: config,
            contract: config,
            singleton: false,
          };
        } else {
          return { singleton: false, ...config };
        }
      }
    );
    config.upgradeManager = { contracts };
  }
);

task("deploy:status", "shows deploy status", async () => {
  console.log("Deploy status 2");
});

type TaskParams = {
  deployNetwork: string;
  fork: boolean;
  dryRun: boolean;
  impersonateAddress?: string;
  derivationPath?: string;
  autoConfirm: boolean;
  newVersion: string;
};

function deployTask(
  taskName: string,
  taskDescription: string,
  cb: (deployConfig: DeployConfig, params: TaskParams) => Promise<void>
) {
  return task(taskName, taskDescription)
    .addPositionalParam(
      "deployNetwork",
      "The network to deploy to",
      undefined,
      types.string,
      false
    )
    .addOptionalParam(
      "fork",
      "Run the deploy against a fork of the network",
      false,
      types.boolean
    )
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
        deployNetwork,
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

      let targetNetwork = fork ? "localhost" : deployNetwork;

      log("Deploying to", targetNetwork);

      if (fork) {
        log(`(Forking ${deployNetwork})`);
      }

      let deployConfig = {
        hre,
        network: deployNetwork,
        targetNetwork,
        forking: fork,
        deployAddress: impersonateAddress,
        dryRun,
        derivationPath,
        autoConfirm,
        mnemonic: process.env.DEPLOY_MNEMONIC,
      };

      let deployAddress: string = await getDeployAddress(deployConfig);

      await cb({ ...deployConfig, deployAddress }, params);
    });
}

deployTask(
  "deploy",
  "Deploys new contracts and propose implementation and config changes for existing deployed contracts",
  deploy
);

deployTask(
  "deploy:execute",
  "Applies pending contract upgrades and config changes atomically",
  (config: DeployConfig, { newVersion }) => execute(config, newVersion)
).addPositionalParam(
  "newVersion",
  "The new version number to set on the upgrade manager. Does not have to increase or change",
  undefined,
  types.string,
  false
);
