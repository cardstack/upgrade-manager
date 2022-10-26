import { AddressZero } from "@ethersproject/constants";
import { BigNumberish, ContractTransaction } from "ethers";
import { ethers, upgrades } from "hardhat";
import { HardhatPluginError } from "hardhat/plugins";
import isEqual from "lodash/isEqual";

import { DeployConfig } from "./types";
import {
  assert,
  confirm,
  encodeWithSignature,
  formatEncodedCall,
  getSigner,
  getUpgradeManager,
  log,
  PLUGIN_NAME,
} from "./util";

const {
  erc1967: { getAdminAddress },
} = upgrades;

const GnosisSafeProxyFactoryAddress =
  "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2";
const GnosisSafeMasterCopyAddress =
  "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552";

export async function safeOwnership(
  config: DeployConfig,
  newSafeOwners: string[],
  newSafeThreshold: BigNumberish
) {
  let upgradeManager = await getUpgradeManager(config);
  let upgradeManagerOwner = await upgradeManager.owner();
  log("Upgrade manager address", upgradeManager.address);
  log("UpgradeManager owner:", upgradeManagerOwner);

  let upgradeManagerAdminAddress = await getAdminAddress(
    upgradeManager.address
  );
  log("Upgrade manager admin address", upgradeManagerAdminAddress);

  let proxyAdmin = await ethers.getContractAt(
    "IProxyAdmin",
    upgradeManagerAdminAddress
  );

  let proxyAdminOwner = await proxyAdmin.owner();
  log("Proxy admin owner", proxyAdminOwner);
  assert(
    proxyAdminOwner == upgradeManager.address,
    "The upgrade manager proxy admin owner should be the upgrade manager itself"
  );

  let gnosisSafeProxyFactory = await ethers.getContractAt(
    "GnosisSafeProxyFactory",
    GnosisSafeProxyFactoryAddress,
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

  if (
    !(await confirm(
      `Setup call for gnosis safe:
        ${formatEncodedCall(
          await ethers.getContractFactory("GnosisSafe"),
          encodedSetupCall
        )}
      `
    ))
  ) {
    process.exit(0);
  }

  let tx: ContractTransaction = await gnosisSafeProxyFactory.createProxy(
    GnosisSafeMasterCopyAddress,
    encodedSetupCall
  );

  let receipt = await tx.wait();

  let creationEvent = (receipt.events || []).find(
    (e) => e.event === "ProxyCreation"
  );

  if (!creationEvent) {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      "Could not find safe creation event in transaction receipt"
    );
  }

  let safeAddress = creationEvent.args.proxy;

  log("Created safe at address", safeAddress);

  let safe = await ethers.getContractAt("GnosisSafe", safeAddress);
  let resultingSafeOwners = await safe.getOwners();

  assert(
    isEqual(resultingSafeOwners.slice().sort(), resultingSafeOwners.sort()),
    "New safe does not have expected owners, aborting"
  );

  assert(
    (await safe.getThreshold()).eq(newSafeThreshold),
    "New safe does not have expected threshold, aborting"
  );

  tx = await upgradeManager.transferOwnership(safeAddress);
  await tx.wait();

  assert(
    (await upgradeManager.owner()).toLowerCase() == safeAddress.toLowerCase(),
    "Ownership transfer failed"
  );

  log("Ownership of upgrade manager transferred to safe at", safeAddress);
}
