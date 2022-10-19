import { AddressZero } from "@ethersproject/constants";
import { readJSONSync } from "fs-extra";
import glob from "glob";
import { shuffle } from "lodash";
import difference from "lodash/difference";
import { ContractAddressMap, DeployConfig, PendingChanges } from "./types";

import { getProxyAdminFactory } from "@openzeppelin/hardhat-upgrades/dist/utils";
import {
  deployedCodeMatches,
  deployedImplementationMatches,
  deployNewProxyAndImplementation,
  getOrDeployUpgradeManager,
  getSigner,
  log,
  makeFactory,
  retryAndWaitForNonceIncrease,
} from "./util";
import { Contract } from "ethers";

export default async function (config: DeployConfig): Promise<{
  unverifiedImpls: string[];
  pendingChanges: PendingChanges;
  addresses: ContractAddressMap;
}> {
  const { network: sourceNetwork, hre } = config;

  const { ethers } = hre;

  const pendingChanges: PendingChanges = {
    newImplementations: {},
    encodedCalls: {},
  };

  const addresses: ContractAddressMap = {};

  let previousImpls = implAddresses(sourceNetwork);

  let upgradeManager = await getOrDeployUpgradeManager(config);
  let contracts = hre.config.upgradeManager.contracts;

  // Contracts are shuffled to deploy in random order, as a workaround to issues
  // deploying to certain testnets where it's suspected nodes have stuck transactions
  // with conflicting nonces not yet mined but in the mempool
  for (let contractConfig of shuffle(contracts)) {
    let { id: contractId, contract: contractName, abstract } = contractConfig;

    log("Contract:", contractId);

    let proxyAddress = await upgradeManager.adoptedContractAddresses(
      contractId
    );

    if (proxyAddress !== AddressZero && !abstract) {
      addresses[contractId] = proxyAddress;

      log(`Checking ${contractId} (${contractName}@${proxyAddress}) ...`);

      if (await deployedCodeMatches(config, contractName, proxyAddress)) {
        log(
          `Deployed bytecode already matches for ${contractName}@${proxyAddress} - no need to deploy new version`
        );
      } else {
        log(
          `Bytecode changed for ${contractName}@${proxyAddress}... Proposing upgrade`
        );

        if (config.dryRun) {
          pendingChanges.newImplementations[contractId] = "<Unknown - dry run>";
        } else {
          let factory = await makeFactory(config, contractName);

          let newImplementationAddress: string =
            (await hre.upgrades.prepareUpgrade(
              proxyAddress,
              factory
            )) as string;

          pendingChanges.newImplementations[contractId] =
            newImplementationAddress;
        }
      }
    } else if (abstract) {
      // Abstract contracts are implementation only, and therefore do not need a proxy

      let currentAddress = await upgradeManager.getAbstractContractAddress(
        contractId
      );

      // proxyAddress = readMetadata(`${contractId}Address`, sourceNetwork);
      if (
        currentAddress != AddressZero &&
        (await deployedImplementationMatches(
          config,
          contractName,
          currentAddress
        ))
      ) {
        log(
          "Deployed implementation of",
          contractName,
          "is already up to date"
        );
      } else {
        log(
          `Deploying new abstract contract ${contractId} (${contractName})...`
        );

        if (!config.dryRun) {
          let factory = await makeFactory(config, contractName);

          let contract: Contract = await retryAndWaitForNonceIncrease(
            config,
            async () => {
              let c = await factory.deploy();
              return c.deployed();
            }
          );
          log(
            `Deployed new abstract contract ${contractId} (${contractName}) to ${contract.address}`
          );
          addresses[contractId] = contract.address;

          await retryAndWaitForNonceIncrease(config, () =>
            upgradeManager.proposeAbstract(contractId, contract.address)
          );
        }
      }
    } else {
      log(`Deploying new contract ${contractId} (${contractName})...`);

      if (!config.dryRun) {
        let instance = await deployNewProxyAndImplementation(
          config,
          contractName,
          [upgradeManager.address]
        );

        log(
          `Deployed new proxy for ${contractId} (contract name: ${contractName}) to address ${instance.address}, adopting`
        );

        addresses[contractId] = instance.address;

        let proxyAdminAddress = await hre.upgrades.erc1967.getAdminAddress(
          instance.address
        );

        let signer = await getSigner(config);
        let ProxyAdmin = await getProxyAdminFactory(config.hre, signer);
        let proxyAdmin = ProxyAdmin.attach(proxyAdminAddress);
        let proxyAdminOwner = await proxyAdmin.owner();
        if (proxyAdminOwner !== upgradeManager.address) {
          log(
            `Proxy admin ${proxyAdmin.address} is not owned by upgrade manager, it is owned by ${proxyAdminOwner}, transferring`
          );
          await retryAndWaitForNonceIncrease(config, () =>
            proxyAdmin.transferOwnership(upgradeManager.address)
          );
        }

        await retryAndWaitForNonceIncrease(config, () =>
          upgradeManager.adoptContract(
            contractId,
            instance.address,
            proxyAdminAddress
          )
        );

        log("New contract", contractId, "adopted successfully");
      }
    }
  }

  let unverifiedImpls = difference(implAddresses(sourceNetwork), previousImpls);

  return {
    unverifiedImpls,
    pendingChanges,
    addresses,
  };
}

function implAddresses(network: string) {
  let networkId: number;
  switch (network) {
    case "sokol":
      networkId = 77;
      break;
    case "xdai":
      networkId = 100;
      break;
    case "goerli":
      networkId = 5;
      break;
    case "hardhat":
    case "localhost":
      networkId = 31337;
      break;
    default:
      throw new Error(`Do not know network ID for network ${network}`);
  }
  let [file] = glob.sync(`./.openzeppelin/*-${networkId}.json`);
  if (!file) {
    return [];
  }
  let json = readJSONSync(file);
  return Object.values(json.impls).map(
    (i) => (i as { address: string }).address
  );
}
