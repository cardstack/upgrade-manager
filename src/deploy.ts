// import configureCardProtocol from "./configure-card-protocol";
import deployContracts from "./deploy-contracts";

import { log } from "./util";

import { DeployConfig } from "./types";

export async function deploy(config: DeployConfig) {
  log("Deploying from", config.deployAddress);

  //const { pendingChanges, unverifiedImpls } =
  await deployContracts(config);

  /*
  await configureCardProtocol(network, pendingChanges);

  let contracts = contractInitSpec({ network, onlyUpgradeable: true });
  let proxyAddresses = await getProxyAddresses(network);

  let upgradeManager = (await getUpgradeManager(network)).connect(
    getSigner(deployAddress)
  );

  let alreadyPending = await upgradeManager.getProxiesWithPendingChanges();

  for (let [contractId] of Object.entries(contracts)) {
    let proxyAddress = proxyAddresses[contractId].proxy;

    let newImplementation = pendingChanges.newImplementations[contractId];
    let encodedCall = pendingChanges.encodedCalls[contractId];

    let proposeWithWithdrawIfNeeded = async function (cb) {
      if (alreadyPending.includes(proxyAddress)) {
        log("Withdraw needed first for", contractId);
        await upgradeManager.withdrawChanges(contractId);
      }
      return await retryAndWaitForNonceIncrease(cb);
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
      await proposeWithWithdrawIfNeeded(
        async () =>
          await upgradeManager.proposeUpgradeAndCall(
            contractId,
            newImplementation,
            encodedCall
          )
      );
    } else if (newImplementation) {
      log("Proposing upgrade for", contractId);
      await proposeWithWithdrawIfNeeded(
        async () =>
          await upgradeManager.proposeUpgrade(contractId, newImplementation)
      );
      log(`Successfully proposed upgrade`);
    } else if (encodedCall) {
      log("Proposing call for", contractId);
      await proposeWithWithdrawIfNeeded(
        async () => await upgradeManager.proposeCall(contractId, encodedCall)
      );
    }
  }

  console.log((await reportProtocolStatus(network)).table.toString());

  let reverify = [];

  for (let impl of unverifiedImpls) {
    if (!process.env.SKIP_VERIFY) {
      try {
        await hre.run("verify:verify", {
          address: impl,
          constructorArguments: [],
        });
      } catch (e) {
        console.error(e);
      }
    }
    reverify.push(impl);
  }

  if (reverify.length > 0) {
    log(`
  Implementation contract verification commands:`);
    for (let address of reverify) {
      log(`npx hardhat verify --network ${network} ${address}`);
    }
  }*/
}
/*
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
  if (pendingAddress === ethers.constants.AddressZero) {
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
*/
