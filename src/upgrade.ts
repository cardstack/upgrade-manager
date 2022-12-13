import { SafeSignature } from "@gnosis.pm/safe-contracts";

import { maybeSafeTransaction } from "./safe";
import { reportProtocolStatus } from "./status";
import { DeployConfig } from "./types";
import { getUpgradeManager, log, confirmOrAutoconfirm } from "./util";

export async function upgrade(
  config: DeployConfig,
  newVersion: string
): Promise<SafeSignature[] | undefined> {
  log("Sending transactions from", config.deployAddress);

  await reportProtocolStatus(config, { quiet: true });

  let upgradeManager = await getUpgradeManager(config);

  let nonce = await upgradeManager.nonce();
  log("Upgrade Manager nonce for these changes:", nonce.toString());

  let currentVersion = await upgradeManager.version();

  if (
    !(await confirmOrAutoconfirm(
      config.autoConfirm,
      `Confirm upgrade of contracts with above changes (${currentVersion} -> ${newVersion})?`
    ))
  ) {
    log("Cancelling upgrade");
    process.exit(1);
  }

  let signatures = maybeSafeTransaction(config, (iface) =>
    iface.encodeFunctionData("upgrade", [newVersion, nonce])
  );

  return signatures;
}
