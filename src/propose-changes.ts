import { AddressZero } from "@ethersproject/constants";
import colors from "colors/safe";
import { Contract } from "ethers";

import {
  ContractAddressMap,
  DeployConfig,
  PendingChanges,
  RetryCallback,
} from "./types";
import { getUpgradeManager, log, retryAndWaitForNonceIncrease } from "./util";

export default async function (
  deployConfig: DeployConfig,
  pendingChanges: PendingChanges,
  addresses: ContractAddressMap
) {
  let upgradeManager = await getUpgradeManager(deployConfig);

  let alreadyPending = await upgradeManager.getProxiesWithPendingChanges();
  let defaultLog = log;

  for (let [contractId, proxyAddress] of Object.entries(addresses)) {
    let log = (...strs: string[]) =>
      defaultLog(colors.yellow(`[${contractId}]`), ...strs);

    let newImplementation = pendingChanges.newImplementations[contractId];
    let encodedCall = pendingChanges.encodedCalls[contractId];

    let proposeWithWithdrawIfNeeded = async function <T>(cb: RetryCallback<T>) {
      if (alreadyPending.includes(proxyAddress)) {
        log("Withdraw needed first for", contractId);
        await retryAndWaitForNonceIncrease(deployConfig, () =>
          upgradeManager.withdrawChanges(contractId)
        );
      }
      return await retryAndWaitForNonceIncrease<T>(deployConfig, cb);
    };

    if (!newImplementation && !encodedCall) {
      continue;
    } else if (
      await proposalMatches({
        newImplementation,
        encodedCall,
        proxyAddress,
        upgradeManager,
      })
    ) {
      log(
        "Already proposed upgrade for",
        contractId,
        "matches, no action needed"
      );
    } else if (newImplementation && encodedCall) {
      log("Proposing upgrade and call for", contractId);
      await proposeWithWithdrawIfNeeded(() =>
        upgradeManager.proposeUpgradeAndCall(
          contractId,
          newImplementation,
          encodedCall
        )
      );
    } else if (newImplementation) {
      log("Proposing upgrade for", contractId);
      await proposeWithWithdrawIfNeeded(() =>
        upgradeManager.proposeUpgrade(contractId, newImplementation)
      );
      log(`Successfully proposed upgrade`);
    } else if (encodedCall) {
      log("Proposing call for", contractId);
      await proposeWithWithdrawIfNeeded(() =>
        upgradeManager.proposeCall(contractId, encodedCall)
      );
    }
  }
}

async function proposalMatches({
  newImplementation,
  encodedCall,
  upgradeManager,
  proxyAddress,
}: {
  newImplementation: string | false;
  encodedCall: string | false;
  upgradeManager: Contract;
  proxyAddress: string;
}) {
  let pendingAddress = await upgradeManager.getPendingUpgradeAddress(
    proxyAddress
  );
  if (pendingAddress === AddressZero) {
    pendingAddress = undefined;
  }

  if (pendingAddress !== newImplementation) {
    return false;
  }

  let pendingCallData = await upgradeManager.getPendingCallData(proxyAddress);
  if (pendingCallData === "0x") {
    pendingCallData = undefined;
  }
  if (pendingCallData !== encodedCall) {
    return false;
  }
  return true;
}
