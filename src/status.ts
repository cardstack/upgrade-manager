import { AddressZero } from "@ethersproject/constants";
import Table from "cli-table3";
import { HardhatPluginError } from "hardhat/plugins";
import { UpgradeManagerContractConfig } from "hardhat/types";

import { DeployConfig } from "./types";
import {
  deployedCodeMatches,
  deployedImplementationMatches,
  formatEncodedCall,
  getSourceProvider,
  getUpgradeManager,
  log,
  PLUGIN_NAME,
} from "./util";

export async function reportProtocolStatus(
  config: DeployConfig,
  { quiet = false }: { quiet: boolean }
) {
  let { table, anyChanged } = await getProtocolStatus(config, true);
  console.log(table.toString());

  if (anyChanged) {
    if (quiet) {
      console.log("Changes detected, not exiting due to quiet param");
    } else {
      console.log("Exiting with exit code 1 because changes were detected");
      process.exit(1);
    }
  } else {
    console.log("No changes detected to deploy");
  }
  return { table, anyChanged };
}

export async function getProtocolStatus(
  config: DeployConfig,
  includeUnchanged = false
): Promise<{ table: Table.Table; anyChanged: boolean }> {
  let upgradeManager = await getUpgradeManager(config, true);

  let contractsConfig = config.hre.config.upgradeManager.contracts;

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

  for (let proxyAddress of await upgradeManager.getProxies()) {
    let adoptedContract = await upgradeManager.adoptedContractsByProxyAddress(
      proxyAddress
    );

    let contractConfig = getContractConfig(contractsConfig, adoptedContract.id);

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

  let proposedAbstractCount = (
    await upgradeManager.getProposedAbstractContractsLength()
  ).toNumber();

  let proposedAbstracts: { [contractId: string]: string } = {};

  for (let i = 0; i < proposedAbstractCount; i++) {
    let proposedAbstract = await upgradeManager.proposedAbstractContracts(i);
    proposedAbstracts[proposedAbstract.id] = proposedAbstract.contractAddress;
  }

  for (let abstractContractIdHash of await upgradeManager.getAbstractContractIdHashes()) {
    let abstractContract = await upgradeManager.abstractContractsByIdHash(
      abstractContractIdHash
    );
    let abstractContractAddress = abstractContract.contractAddress;
    let contractConfig = getContractConfig(
      contractsConfig,
      abstractContract.id
    );
    let contractName = contractConfig.contract;
    log(
      "Checking abstract contract implementation",
      contractName,
      "at",
      abstractContractAddress
    );
    let localBytecodeChanged = (await deployedImplementationMatches(
      config,
      contractName,
      abstractContractAddress
    ))
      ? null
      : "YES";

    let proposedAddress = proposedAbstracts[abstractContract.id];

    let codeChanges =
      localBytecodeChanged ||
      (proposedAddress &&
        proposedAddress.toLowerCase() != abstractContractAddress);

    if (codeChanges) {
      anyChanged = true;
    }

    if (!codeChanges && !includeUnchanged) {
      continue;
    }

    table.push([
      abstractContract.id,
      contractName,
      null,
      abstractContractAddress,
      proposedAddress == AddressZero
        ? "DELETION PROPOSED"
        : proposedAddress || null,
      null,
      localBytecodeChanged,
    ]);

    delete proposedAbstracts[abstractContract.id];
  }

  for (let [contractId, proposedAddress] of Object.entries(proposedAbstracts)) {
    // Because of the delete statement above, any proposals here are now for new,
    // as-yet unregistered contract ids
    anyChanged = true;

    let contractConfig = getContractConfig(contractsConfig, contractId);

    table.push([
      contractId,
      contractConfig.contract,
      null,
      "N/A (proposed)",
      proposedAddress || null,
      null,
      "YES",
    ]);
  }

  return { table, anyChanged };
}

function getContractConfig(
  contractsConfig: UpgradeManagerContractConfig[],
  contractId: string
) {
  let contractConfig = contractsConfig.find((c) => c.id == contractId);

  if (!contractConfig) {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `Could not find contract config in your local configuration for contract ${contractId}`
    );
  }
  return contractConfig;
}
