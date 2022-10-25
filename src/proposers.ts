import { HardhatPluginError } from "hardhat/plugins";

import { DeployConfig } from "./types";
import {
  getUpgradeManager,
  log,
  PLUGIN_NAME,
  retryAndWaitForNonceIncrease,
} from "./util";

export async function addProposer(
  config: DeployConfig,
  proposerAddress: string
): Promise<void> {
  let upgradeManager = await getUpgradeManager(config, true);

  if (
    (await upgradeManager.getUpgradeProposers())
      .map((a) => a.toLowerCase())
      .includes(proposerAddress.toLowerCase())
  ) {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `${proposerAddress} is already a proposer`
    );
  }
  log("Adding proposer", proposerAddress);
  await retryAndWaitForNonceIncrease(config, async () =>
    (await upgradeManager.addUpgradeProposer(proposerAddress)).wait()
  );
  log("Success");
  // TODO: safe
}

export async function removeProposer(
  config: DeployConfig,
  proposerAddress: string
): Promise<void> {
  let upgradeManager = await getUpgradeManager(config, true);

  if (
    !(await upgradeManager.getUpgradeProposers())
      .map((a) => a.toLowerCase())
      .includes(proposerAddress.toLowerCase())
  ) {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `${proposerAddress} is not a proposer`
    );
  }
  log("Removing proposer", proposerAddress);
  await retryAndWaitForNonceIncrease(config, async () =>
    (await upgradeManager.removeUpgradeProposer(proposerAddress)).wait()
  );
  log("Success");

  // TODO: safe
}
