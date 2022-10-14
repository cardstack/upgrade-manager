import deployContracts from "./deploy-contracts";
import configureContracts from "./configure-contracts";
import proposeChanges from "./propose-changes";

import { log } from "./util";

import { DeployConfig } from "./types";

export async function deploy(config: DeployConfig) {
  log("Deploying from", config.deployAddress);

  const { pendingChanges, addresses } = await deployContracts(config);

  await configureContracts(config, pendingChanges, addresses);

  await proposeChanges(config, pendingChanges, addresses);
  // TODO: Report Status
  // console.log((await reportProtocolStatus(network)).table.toString());

  // TODO: Verification
  //  let reverify = [];

  //  for (let impl of unverifiedImpls) {
  //    if (!process.env.SKIP_VERIFY) {
  //      try {
  //        await hre.run("verify:verify", {
  //          address: impl,
  //          constructorArguments: [],
  //        });
  //      } catch (e) {
  //        console.error(e);
  //      }
  //    }
  //    reverify.push(impl);
  //  }

  //  if (reverify.length > 0) {
  //    log(`
  // Implementation contract verification commands:`);
  //    for (let address of reverify) {
  //      log(`npx hardhat verify --network ${network} ${address}`);
  //    }
  //  }
}
