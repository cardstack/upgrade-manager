import { HardhatPluginError } from "hardhat/plugins";

import { SafeSignature } from "./safe";
import { DeployConfig } from "./types";
import {
  getUpgradeManager,
  PLUGIN_NAME,
  retryAndWaitForNonceIncrease,
} from "./util";

export async function withdrawAllAbstractProposals(
  config: DeployConfig
): Promise<SafeSignature[] | undefined> {
  let upgradeManager = await getUpgradeManager(config, true);
  if (
    (await upgradeManager.getProposedAbstractContractsLength()).toNumber() == 0
  ) {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `There are no abstract contract proposals`
    );
  }
  await retryAndWaitForNonceIncrease(config, async () => {
    upgradeManager.withdrawAllAbstractProposals();
  });
  return;
}
