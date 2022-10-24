import configureContracts from "./configure-contracts";
import deployContracts from "./deploy-contracts";
import proposeChanges from "./propose-changes";
import { getProtocolStatus } from "./status";
import { DeployConfig } from "./types";
import { log } from "./util";

export async function deploy(config: DeployConfig) {
  log("Deploying from", config.deployAddress);

  const { pendingChanges, addresses } = await deployContracts(config);

  await configureContracts(config, pendingChanges, addresses);

  await proposeChanges(config, pendingChanges, addresses);
  log(
    "Staged changes (not showing unchanged contracts, run deploy:status to see full contract status)"
  );
  console.log((await getProtocolStatus(config)).table.toString());
}
