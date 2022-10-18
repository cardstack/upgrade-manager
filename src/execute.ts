import {
  getUpgradeManager,
  log,
  retryAndWaitForNonceIncrease,
  formatEncodedCall,
  confirmOrAutoconfirm,
} from "./util";

import { DeployConfig } from "./types";

export async function execute(config: DeployConfig, newVersion: string) {
  log("Sending transactions from", config.deployAddress);

  // TODO: report status
  // console.log((await reportProtocolStatus(network)).table.toString());

  // TODO: dry run

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
  let upgradeManagerOwner = await upgradeManager.owner();

  if (upgradeManagerOwner === config.deployAddress) {
    log(
      `The upgrade manager is owned by the active deploy address ${config.deployAddress}; Sending a regular upgrade transaction`
    );
    await retryAndWaitForNonceIncrease(config, () =>
      upgradeManager.upgrade(newVersion, nonce)
    );
    log("Success");
  } else {
    log(
      `Owner of the upgrade manager is not the active deploy address, attempting safe transaction`
    );

    let data = upgradeManager.interface.encodeFunctionData("upgrade", [
      newVersion,
      nonce,
    ]);

    log(
      `Preparing to call function on UpgradeManager@${upgradeManager.address} via safe:\n`,
      formatEncodedCall(upgradeManager, data)
    );

    // TODO: safe
    // await safeTransaction({
    //   signerAddress: deployAddress,
    //   safeAddress: upgradeManagerOwner,
    //   to: upgradeManager.address,
    //   data,
    //   priorSignatures: true,
    // });
  }
}
