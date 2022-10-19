import deployContracts from "./deploy-contracts";
import configureContracts from "./configure-contracts";
import proposeChanges from "./propose-changes";

import { log } from "./util";

import { DeployConfig } from "./types";
import { getProtocolStatus } from "./status";

export async function deploy(config: DeployConfig) {
  log("Deploying from", config.deployAddress);

  const { pendingChanges, addresses } = await deployContracts(config);

  await configureContracts(config, pendingChanges, addresses);

  await proposeChanges(config, pendingChanges, addresses);
  console.log((await getProtocolStatus(config)).table.toString());
}
