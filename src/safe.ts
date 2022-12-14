import { AddressZero } from "@ethersproject/constants";
import { AddressOne } from "@gnosis.pm/safe-contracts";
import { BigNumber, Contract } from "ethers";
import { concat } from "ethers/lib/utils";
import { HardhatPluginError } from "hardhat/plugins";
import { sortBy } from "lodash";
import isEqual from "lodash/isEqual";

import { IProxyAdmin } from "../typechain-types";
import { UpgradeManagerInterface } from "../typechain-types/contracts/UpgradeManager";
import { GnosisSafeProxyFactory__factory } from "../typechain-types/factories/@gnosis.pm/safe-contracts/contracts/proxies";

import { DeployConfig } from "./types";
import {
  assert,
  confirmOrAutoconfirm,
  encodeWithSignature,
  formatEncodedCall,
  getGnosisSafeProxyFactoryAddress,
  getGnosisSafeSingletonAddress,
  getSigner,
  getSourceChainId,
  getUpgradeManager,
  log,
  makeFactory,
  PLUGIN_NAME,
  retryAndWaitForNonceIncrease,
} from "./util";

export async function safeOwnership(
  config: DeployConfig,
  {
    newSafeOwners,
    newSafeThreshold,
  }: { newSafeOwners: string[]; newSafeThreshold: number }
) {
  let upgradeManager = await getUpgradeManager(config);
  let upgradeManagerOwner = await upgradeManager.owner();
  log("Upgrade manager address", upgradeManager.address);
  log("UpgradeManager owner:", upgradeManagerOwner);

  let upgradeManagerAdminAddress =
    await config.hre.upgrades.erc1967.getAdminAddress(upgradeManager.address);
  log("Upgrade manager admin address", upgradeManagerAdminAddress);

  let proxyAdmin = (await makeFactory(config, "IProxyAdmin")).attach(
    upgradeManagerAdminAddress
  ) as IProxyAdmin;

  let proxyAdminOwner = await proxyAdmin.owner();
  log("Proxy admin owner", proxyAdminOwner);
  assert(
    proxyAdminOwner == upgradeManager.address,
    "The upgrade manager proxy admin owner should be the upgrade manager itself"
  );

  let gnosisSafeProxyFactory = GnosisSafeProxyFactory__factory.connect(
    getGnosisSafeProxyFactoryAddress(config),
    await getSigner(config)
  );
  let encodedSetupCall = encodeWithSignature(
    config,
    "setup(address[],uint256,address,bytes,address,address,uint256,address)",
    newSafeOwners,
    newSafeThreshold,
    AddressZero,
    "0x",
    AddressZero,
    AddressZero,
    0,
    AddressZero
  );

  let GnosisSafe = await makeFactory(config, "GnosisSafe");

  if (
    !(await confirmOrAutoconfirm(
      config.autoConfirm,
      `Setup call for gnosis safe:
        ${formatEncodedCall(GnosisSafe, encodedSetupCall)}
      `
    ))
  ) {
    process.exit(0);
  }

  let tx = await gnosisSafeProxyFactory.createProxy(
    getGnosisSafeSingletonAddress(config),
    encodedSetupCall
  );

  let receipt = await tx.wait();

  let creationEvent = (receipt.events || []).find(
    (e) => e.event === "ProxyCreation"
  );

  if (!creationEvent?.args) {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      "Could not find safe creation event"
    );
  }

  let safeAddress = creationEvent.args.proxy;

  log("Created safe at address", safeAddress);

  let safe = GnosisSafe.attach(safeAddress);
  let newSafeOwnersAfterCreate = await safe.getOwners();

  assert(
    isEqual(
      newSafeOwnersAfterCreate.slice().sort(),
      (newSafeOwners as Array<string>).sort()
    ),
    "New safe does not have expected owners, aborting"
  );

  assert(
    ((await safe.getThreshold()) as BigNumber).eq(newSafeThreshold as number),
    "New safe does not have expected threshold, aborting"
  );

  await retryAndWaitForNonceIncrease(config, () =>
    upgradeManager.transferOwnership(safeAddress)
  );

  assert(
    (await upgradeManager.owner()).toLowerCase() == safeAddress.toLowerCase(),
    "Ownership transfer failed"
  );

  log("Ownership of upgrade manager transferred to safe at", safeAddress);
}

export async function safeTransaction({
  config,
  safeAddress,
  data,
  toContract,
  value = 0,
  operation = CALL,
  safeTxGas = 0,
  baseGas = 0,
  gasPrice = 0,
  gasToken = AddressZero,
  refundReceiver = AddressZero,
}: {
  config: DeployConfig;
  safeAddress: string;
  toContract: Contract;
  data: string;
  value?: number;
  operation?: number;
  safeTxGas?: number;
  baseGas?: number;
  gasPrice?: number;
  gasToken?: string;
  refundReceiver?: string;
}): Promise<SafeSignature[] | undefined> {
  let signer = await getSigner(config);
  let GnosisSafe = await makeFactory(config, "GnosisSafe");
  let safe = GnosisSafe.attach(safeAddress);
  log("Preparing for safe transaction using safe", safeAddress);
  let safeVersion = await safe.VERSION();
  log("It looks like a safe, version", safeVersion);
  let safeOwners = await safe.getOwners();
  if (!safeOwners.includes(config.deployAddress)) {
    throw new Error(
      `Signer address ${config.deployAddress} is not an owner of safe ${safe.address}`
    );
  }
  let threshold = await safe.getThreshold();
  let nonce = (await safe.nonce()).toNumber();

  log(
    `We have ${config.priorSignatures.length} prior signatures, and the safe threshold is ${threshold}. Safe nonce is ${nonce}.`
  );

  if (
    config.priorSignatures.some(
      (s) => s.signer === config.deployAddress.toLowerCase()
    )
  ) {
    throw new Error(
      `Signer ${config.deployAddress} is already included in priorSignatures`
    );
  }

  let chainId = getSourceChainId(config);

  let domain = {
    verifyingContract: safe.address,
    chainId,
  };

  let message = {
    to: toContract.address,
    value,
    data,
    operation,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    nonce,
  };

  log(
    `Proposed call to ${toContract.address}:\n`,
    formatEncodedCall(toContract, data)
  );

  let signatureBytes = await signer._signTypedData(
    domain,
    SafeTxTypes,
    message
  );

  if (signatureBytes.slice(0, 2) != "0x") {
    signatureBytes = `0x${signatureBytes}`;
  }

  let signature: SafeSignature = {
    signer: config.deployAddress.toLowerCase(),
    data: signatureBytes,
  };
  let signatures = [...config.priorSignatures, signature];

  if (signatures.length >= threshold.toNumber()) {
    log("We have enough signatures, submitting safe transaction");

    if (
      !(await confirmOrAutoconfirm(
        config.autoConfirm,
        "Execute safe transaction?"
      ))
    ) {
      process.exit(1);
    }

    let concatenatedSignatures = concat(
      sortBy(signatures, (s) => s.signer).map((s) => s.data)
    );

    let receipt = await retryAndWaitForNonceIncrease(config, async () => {
      let tx = await safe.execTransaction(
        toContract.address,
        value,
        data,
        operation,
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        refundReceiver,
        concatenatedSignatures
      );

      log("Submitted transaction", tx.hash);

      return await tx.wait();
    });

    log("Transaction successful", receipt.transactionHash);
  } else {
    log(
      "We only have",
      signatures.length,
      "signatures, but the threshold is",
      threshold.toString()
    );
    log(
      "Still not enough signatures to submit, please gather",
      threshold.toNumber() - signatures.length,
      "more signatures. Current signature list:"
    );

    log(`"${encodePriorSignatures(signatures)}"`);

    return signatures;
  }
}

export type SafeSignature = {
  signer: string;
  data: string;
};

export const CALL = 0;
export const DELEGATE_CALL = 1;

export const SafeTxTypes = {
  SafeTx: [
    {
      type: "address",
      name: "to",
    },
    {
      type: "uint256",
      name: "value",
    },
    {
      type: "bytes",
      name: "data",
    },
    {
      type: "uint8",
      name: "operation",
    },
    {
      type: "uint256",
      name: "safeTxGas",
    },
    {
      type: "uint256",
      name: "baseGas",
    },
    {
      type: "uint256",
      name: "gasPrice",
    },
    {
      type: "address",
      name: "gasToken",
    },
    {
      type: "address",
      name: "refundReceiver",
    },
    {
      type: "uint256",
      name: "nonce",
    },
  ],
};

export async function addSafeOwner(
  config: DeployConfig,
  newSafeOwnerAddress: string,
  newSafeThreshold?: number
): Promise<SafeSignature[] | undefined> {
  const upgradeManager = await getUpgradeManager(config);

  log("Upgrade manager address", upgradeManager.address);

  let safeAddress = await upgradeManager.owner();

  let GnosisSafe = await makeFactory(config, "GnosisSafe");

  let safe = GnosisSafe.attach(safeAddress);
  log("Upgrade manager owner address", safeAddress);

  let currentOwners = await safe.getOwners();
  let currentThreshold = await safe.getThreshold();

  log("Current owners", currentOwners.join(", "));
  log("Current threshold", currentThreshold.toString());

  if (!newSafeThreshold) {
    newSafeThreshold = currentThreshold.toNumber();
  }
  log("New owner", newSafeOwnerAddress);
  log("New threshold", newSafeThreshold);

  if (
    currentOwners.some(
      (o) => o.toLowerCase() === newSafeOwnerAddress.toLowerCase()
    )
  ) {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `${newSafeOwnerAddress} is already an owner of the upgrade manager safe`
    );
  }

  let data = safe.interface.encodeFunctionData("addOwnerWithThreshold", [
    newSafeOwnerAddress,
    newSafeThreshold,
  ]);

  return await safeTransaction({ config, safeAddress, toContract: safe, data });
}

export async function removeSafeOwner(
  config: DeployConfig,
  removeSafeOwnerAddress: string,
  newSafeThreshold?: number
): Promise<SafeSignature[] | undefined> {
  const upgradeManager = await getUpgradeManager(config);

  log("Upgrade manager address", upgradeManager.address);

  let safeAddress = await upgradeManager.owner();

  let GnosisSafe = await makeFactory(config, "GnosisSafe");

  let safe = GnosisSafe.attach(safeAddress);
  log("Upgrade manager owner address", safeAddress);

  let currentOwners = await safe.getOwners();
  let currentThreshold = await safe.getThreshold();

  log("Current owners", currentOwners.join(", "));
  log("Current threshold", currentThreshold.toString());

  if (!newSafeThreshold) {
    newSafeThreshold = currentThreshold.toNumber();
  }

  log("Removing owner", removeSafeOwnerAddress);
  log("New threshold", newSafeThreshold);

  if (
    !currentOwners.some(
      (o) => o.toLowerCase() === removeSafeOwnerAddress.toLowerCase()
    )
  ) {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `${removeSafeOwnerAddress} is not an owner of the upgrade manager safe`
    );
  }

  // Calculate the prevOwnerAddress by finding the position of the
  // removeSafeOwnerAddress in the current owners array, and accessing
  // the previous item in the array
  let removeSafeOwnerIndex = currentOwners.findIndex(
    (o) => o.toLowerCase() === removeSafeOwnerAddress.toLowerCase()
  );
  let prevOwnerAddress =
    removeSafeOwnerIndex > 0
      ? currentOwners[removeSafeOwnerIndex - 1]
      : AddressOne;

  if (!newSafeThreshold) {
    newSafeThreshold = currentThreshold.toNumber();
  }

  let data = safe.interface.encodeFunctionData("removeOwner", [
    prevOwnerAddress,
    removeSafeOwnerAddress,
    newSafeThreshold,
  ]);

  return await safeTransaction({ config, safeAddress, toContract: safe, data });
}

export async function setSafeThreshold(
  config: DeployConfig,
  newSafeThreshold: number
): Promise<SafeSignature[] | undefined> {
  const upgradeManager = await getUpgradeManager(config);

  log("Upgrade manager address", upgradeManager.address);

  let safeAddress = await upgradeManager.owner();

  let GnosisSafe = await makeFactory(config, "GnosisSafe");

  let safe = GnosisSafe.attach(safeAddress);
  log("Upgrade manager owner address", safeAddress);

  let currentOwners = await safe.getOwners();
  let currentThreshold = await safe.getThreshold();

  log("Current owners", currentOwners.join(", "));
  log("Current threshold", currentThreshold.toString());

  log("New threshold", newSafeThreshold);

  let data = safe.interface.encodeFunctionData("changeThreshold", [
    newSafeThreshold,
  ]);

  return await safeTransaction({ config, safeAddress, toContract: safe, data });
}

export async function maybeSafeTransaction(
  config: DeployConfig,
  callback: (iface: UpgradeManagerInterface) => string | Promise<string>
): Promise<SafeSignature[] | undefined> {
  let upgradeManager = await getUpgradeManager(config);

  let owner = await upgradeManager.owner();

  let code = await config.hre.ethers.provider.getCode(owner);

  let data = await callback(upgradeManager.interface);

  if (code === "0x") {
    let signer = await getSigner(config);

    await retryAndWaitForNonceIncrease(config, () =>
      signer.sendTransaction({
        to: upgradeManager.address,
        data,
      })
    );
  } else {
    return await safeTransaction({
      config,
      safeAddress: owner,
      toContract: upgradeManager,
      data,
    });
  }
}

export function decodePriorSignatures(input?: string): SafeSignature[] {
  if (!input) {
    return [];
  }
  return input
    .split(",")
    .map((s) => s.split(":"))
    .map(([signer, data]) => ({
      signer,
      data,
    }));
}

export function encodePriorSignatures(input: SafeSignature[]): string {
  return input.map(({ signer, data }) => `${signer}:${data}`).join(",");
}
