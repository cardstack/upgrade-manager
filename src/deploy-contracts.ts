import { readJSONSync } from "fs-extra";
import glob from "glob";
import { shuffle } from "lodash";
import difference from "lodash/difference";
import { DeployConfig, PendingChanges } from "./types";

import { getProxyAdminFactory } from "@openzeppelin/hardhat-upgrades/dist/utils";
import {
  deployedCodeMatches,
  deployNewProxyAndImplementation,
  getDeployAddress,
  getOrDeployUpgradeManager,
  getSigner,
  log,
  makeFactory,
  retryAndWaitForNonceIncrease,
} from "./util";

export default async function (
  config: DeployConfig
): Promise<{ unverifiedImpls: string[]; pendingChanges: PendingChanges }> {
  const { sourceNetwork, hre } = config;

  const {
    // upgrades: {
    //   prepareUpgrade,
    //   erc1967: { getAdminAddress },
    // },
    ethers,
  } = hre;

  const owner = await getDeployAddress(config);
  log(`Deploying from address ${owner}`);

  const pendingChanges: PendingChanges = {
    newImplementations: {},
    encodedCalls: {},
  };

  let previousImpls = implAddresses(sourceNetwork);

  let upgradeManager = await getOrDeployUpgradeManager(config);
  let contracts = hre.config.upgradeManager.contracts;

  // Contracts are shuffled to deploy in random order, as a workaround to issues
  // deploying to certain testnets where it's suspected nodes have stuck transactions
  // with conflicting nonces not yet mined but in the mempool
  for (let contractConfig of shuffle(contracts)) {
    let { id: contractId, contract: contractName, singleton } = contractConfig;

    log("Contract:", contractId);

    let proxyAddress = await upgradeManager.adoptedContractAddresses(
      contractId
    );

    if (proxyAddress !== ethers.constants.AddressZero && !singleton) {
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
    } else if (singleton) {
      // if the contract is not upgradeable, deploy a new version each time.
      // Deploying a new version each time probably only makes sense for contracts
      // that are used as delegate implementations, and it is done so that when
      // changes are made to that contract, a new one is deployed and other contracts
      // are configured to point to it later.

      // This behaviour makes sense for RewardSafeDelegateImplementation,
      // however it may not make sense for other non-upgradeable contracts in the future

      throw new Error("TODO");

      // proxyAddress = readMetadata(`${contractId}Address`, sourceNetwork);
      // if (
      //   proxyAddress &&
      //   (await deployedImplementationMatches(contractName, proxyAddress))
      // ) {
      //   log(
      //     "Deployed implementation of",
      //     contractName,
      //     "is already up to date"
      //   );
      // } else {
      //   log(
      //     `Deploying new non upgradeable contract ${contractId} (${contractName})...`
      //   );

      //   if (!config.dryRun) {
      //     let factory = await makeFactory(contractName);

      //     let instance: Contract = await retryAndWaitForNonceIncrease(
      //       config,
      //       () => factory.deploy(...init)
      //     );
      //     log(
      //       `Deployed new non upgradeable contract ${contractId} (${contractName}) to ${instance.address}`
      //     );
      //     writeMetadata(
      //       `${contractId}Address`,
      //       instance.address,
      //       sourceNetwork
      //     );
      //   }
      // }
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
          await proxyAdmin.transferOwnership(upgradeManager.address);
        }

        await upgradeManager.adoptContract(
          contractId,
          instance.address,
          proxyAdminAddress
        );

        log("New contract", contractId, "adopted successfully");
      }
    }
  }

  if (
    (await upgradeManager.versionManager()) === ethers.constants.AddressZero
  ) {
    log("Upgrade Manager not setup, setting up now with proposer", owner);
    await retryAndWaitForNonceIncrease(config, () =>
      upgradeManager.setup([owner])
    );
  }

  let unverifiedImpls = difference(implAddresses(sourceNetwork), previousImpls);

  return {
    unverifiedImpls,
    pendingChanges,
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
