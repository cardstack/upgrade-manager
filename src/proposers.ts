import { HardhatPluginError } from "hardhat/plugins";

import { maybeSafeTransaction, SafeSignature } from "./safe";
import { DeployConfig } from "./types";
import { getUpgradeManager, log, PLUGIN_NAME } from "./util";

export async function addProposer(
  config: DeployConfig,
  proposerAddress: string
): Promise<SafeSignature[] | undefined> {
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

  let signatures = await maybeSafeTransaction(config, async (iface) =>
    iface.encodeFunctionData("addUpgradeProposer", [proposerAddress])
  );
  return signatures;
}

export async function removeProposer(
  config: DeployConfig,
  proposerAddress: string
): Promise<SafeSignature[] | undefined> {
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

  return await maybeSafeTransaction(config, async (iface) =>
    iface.encodeFunctionData("removeUpgradeProposer", [proposerAddress])
  );
}
