import { extendConfig, task, types } from "hardhat/config";
// import { lazyObject } from "hardhat/plugins";
import {
  HardhatConfig,
  HardhatUserConfig,
  UpgradeManagerContractConfig,
} from "hardhat/types";
import { deploy } from "./deploy";

// import { ExampleHardhatRuntimeEnvironmentField } from "./ExampleHardhatRuntimeEnvironmentField";
// This import is needed to let the TypeScript compiler know that it should include your type
// extensions in your npm package's types file.

import "./type-extensions";
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
  console.log("Deploy status");
});

task("deploy", "runs the deploy process")
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
    "m/44'/60'/0'/0",
    types.string
  )
  .addOptionalParam(
    "impersonateAddress",
    "Address to impersonate deploying from (usually only makes sense whilst forking)",
    undefined,
    types.string
  )
  .setAction(
    async (
      {
        deployNetwork,
        fork,
        dryRun,
        impersonateAddress,
        derivationPath,
      }: {
        deployNetwork: string;
        fork: boolean;
        dryRun: boolean;
        impersonateAddress?: string;
        derivationPath?: string;
      },
      hre
    ) => {
      // sourceNetworking network is the "source" - the current blockchain
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
        sourceNetwork: deployNetwork,
        targetNetwork,
        forking: fork,
        deployAddress: impersonateAddress,
        dryRun,
        derivationPath,
      };

      let deployAddress: string = await getDeployAddress(deployConfig);

      await deploy({ ...deployConfig, deployAddress });
    }
  );
