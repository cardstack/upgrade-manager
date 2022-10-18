import deployContracts from "./deploy-contracts";
import configureContracts from "./configure-contracts";
import proposeChanges from "./propose-changes";
import Table from "cli-table3";

import {
  deployedCodeMatches,
  formatEncodedCall,
  getSourceProvider,
  getUpgradeManager,
  log,
  PLUGIN_NAME,
} from "./util";

import { DeployConfig } from "./types";
import { AddressZero } from "@ethersproject/constants";
import { HardhatPluginError } from "hardhat/plugins";

export async function reportProtocolStatus(config: DeployConfig) {
  let { table, anyChanged } = await getProtocolStatus(config, true);
  console.log(table.toString());

  if (anyChanged) {
    console.log("Exiting with exit code 1 because changes were detected");
    process.exit(1);
  } else {
    console.log("No changes detected to deploy");
  }
}

export async function getProtocolStatus(
  config: DeployConfig,
  includeUnchanged = false
): Promise<{ table: Table.Table; anyChanged: boolean }> {
  let upgradeManager = await getUpgradeManager(config, true);

  let proxyAddresses = await upgradeManager.getProxies();
  let abstractContractAddresses;

  let { contracts } = config.hre.config.upgradeManager;

  let anyChanged = false;

  let table = new Table({
    head: [
      "Contract ID",
      "Contract Name",
      "Proxy Address",
      "Current Implementation Address",
      "Proposed Implementation Address",
      "Proposed Function Call",
      "Local Bytecode Changed",
    ],
  });

  for (let proxyAddress of proxyAddresses) {
    let adoptedContract = await upgradeManager.adoptedContractsByProxyAddress(
      proxyAddress
    );
    let contractConfig = contracts.find((c) => c.id == adoptedContract.id);

    if (!contractConfig) {
      throw new HardhatPluginError(
        PLUGIN_NAME,
        `Could not find contract config in your local configuration for adopted contract ${adoptedContract.id}`
      );
    }
    let contractName = contractConfig.contract;
    let contract = await config.hre.ethers.getContractAt(
      contractName,
      proxyAddress
    );

    let localBytecodeChanged = (await deployedCodeMatches(
      config,
      contractName,
      proxyAddress
    ))
      ? null
      : "YES";

    let codeChanges =
      adoptedContract.upgradeAddress !== AddressZero ||
      adoptedContract.encodedCall !== "0x" ||
      localBytecodeChanged;

    if (codeChanges) {
      anyChanged = true;
    }

    if (!codeChanges && !includeUnchanged) {
      continue;
    }

    let formattedCall = null;
    if (adoptedContract.encodedCall !== "0x") {
      formattedCall = formatEncodedCall(contract, adoptedContract.encodedCall);

      try {
        await getSourceProvider(config).call({
          data: adoptedContract.encodedCall,
          to: contract.address,
          from: upgradeManager.address,
        });
      } catch (e) {
        formattedCall = `${formattedCall}\nFAILING CALL!: ${e}`;
      }
    }

    table.push([
      adoptedContract.id,
      contractName,
      proxyAddress,
      await config.hre.upgrades.erc1967.getImplementationAddress(proxyAddress),
      adoptedContract.upgradeAddress !== AddressZero
        ? adoptedContract.upgradeAddress
        : null,
      formattedCall,
      localBytecodeChanged,
    ]);
  }

  return { table, anyChanged };
}
