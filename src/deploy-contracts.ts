import { AddressZero } from "@ethersproject/constants";
import { getProxyAdminFactory } from "@openzeppelin/hardhat-upgrades/dist/utils";
import colors from "colors/safe";
import { Contract } from "ethers";
import { readJSONSync } from "fs-extra";
import glob from "glob";
import { shuffle } from "lodash";
import difference from "lodash/difference";

import { deployCreate2Contract, EMPTY_BYTES_32 } from "./create2";
import { ContractAddressMap, DeployConfig, PendingChanges } from "./types";
import {
  deployedCodeMatches,
  deployedImplementationMatches,
  deployNewProxyAndImplementation,
  getOrDeployUpgradeManager,
  getSigner,
  getSourceChainId,
  log,
  makeFactory,
  retryAndWaitForNonceIncrease,
} from "./util";

export default async function (config: DeployConfig): Promise<{
  unverifiedImpls: string[];
  pendingChanges: PendingChanges;
  addresses: ContractAddressMap;
}> {
  const { hre } = config;
  let defaultLog = log;

  const pendingChanges: PendingChanges = {
    newImplementations: {},
    encodedCalls: {},
  };

  const addresses: ContractAddressMap = {};

  let previousImpls = implAddresses(config);

  let upgradeManager = await getOrDeployUpgradeManager(config);
  let contracts = hre.config.upgradeManager.contracts;

  let proposedAbstracts: { [contractId: string]: string } = {};
  for (
    let i = 0;
    i < (await upgradeManager.getProposedAbstractContractsLength()).toNumber();
    i++
  ) {
    let { id, contractAddress } =
      await upgradeManager.proposedAbstractContracts(i);

    // Last one in proposals should win
    proposedAbstracts[id] = contractAddress;
  }

  // Contracts are shuffled to deploy in random order, as a workaround to issues
  // deploying to certain testnets where it's suspected nodes have stuck transactions
  // with conflicting nonces not yet mined but in the mempool
  for (let contractConfig of shuffle(contracts)) {
    let {
      id: contractId,
      contract: contractName,
      abstract,
      deterministic,
    } = contractConfig;

    let log = (...strs: string[]) =>
      defaultLog(colors.yellow(`[${contractId}]`), ...strs);

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

      if (
        currentAddress != AddressZero &&
        (await deployedImplementationMatches(
          config,
          contractName,
          currentAddress
        )) &&
        !proposedAbstracts[contractId]
      ) {
        log(
          "Deployed implementation of",
          contractName,
          "is already up to date"
        );
      } else if (
        proposedAbstracts[contractId] &&
        (await deployedImplementationMatches(
          config,
          contractName,
          proposedAbstracts[contractId]
        ))
      ) {
        log(
          "Proposed  implementation of",
          contractName,
          "is already up to date"
        );
      } else {
        log(
          `Deploying new abstract contract ${contractId} (${contractName})...`
        );

        if (!config.dryRun) {
          let factory = await makeFactory(config, contractName);

          let contract: Contract;
          if (deterministic) {
            let salt;
            if (typeof deterministic == "string") {
              salt = deterministic;
            } else {
              salt = EMPTY_BYTES_32;
            }

            log("Deploying deterministically with salt", salt);

            let address = await deployCreate2Contract({
              bytecode: factory.bytecode,
              signer: factory.signer,
              salt,
              constructorArgs: [
                factory.interface.deploy.inputs,
                contractConfig.constructorArgs,
              ],
            });

            contract = factory.attach(address);
          } else {
            contract = await retryAndWaitForNonceIncrease(config, async () => {
              let c = await factory.deploy(...contractConfig.constructorArgs);
              return c.deployed();
            });
          }

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

  let unverifiedImpls = difference(implAddresses(config), previousImpls);

  return {
    unverifiedImpls,
    pendingChanges,
    addresses,
  };
}

function implAddresses(config: DeployConfig) {
  let chainId = getSourceChainId(config);
  let [file] = glob.sync(`./.openzeppelin/*-${chainId}.json`);
  if (!file) {
    return [];
  }
  let json = readJSONSync(file);
  return Object.values(json.impls).map(
    (i) => (i as { address: string }).address
  );
}
