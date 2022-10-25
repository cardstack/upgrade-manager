import { existsSync } from "fs";
import { join } from "path";

import colors from "colors/safe";
import { Contract } from "ethers";
import { HardhatPluginError } from "hardhat/plugins";

import { UpgradeManager } from "../typechain-types";

import {
  ConfigFunction,
  ContractAddressMap,
  DeployConfig,
  PendingChanges,
} from "./types";
import {
  describeNetwork,
  formatEncodedCall,
  getUpgradeManager,
  isSolidityValuesEqual,
  log,
  makeFactory,
  PLUGIN_NAME,
  retry,
  retryAndWaitForNonceIncrease,
} from "./util";

type LogFunc = typeof log;
export default async function (
  deployConfig: DeployConfig,
  pendingChanges: PendingChanges,
  addresses: ContractAddressMap
): Promise<void> {
  log(`Configuring contracts on ${describeNetwork(deployConfig)}`);

  let upgradeManager = await getUpgradeManager(deployConfig);

  let upgradeManagerConfig = deployConfig.hre.config.upgradeManager;
  let defaultLog = log;

  for (const {
    id: contractId,
    contract: contractName,
    abstract,
  } of upgradeManagerConfig.contracts) {
    let log = (...strs: string[]) =>
      defaultLog(colors.yellow(`[${contractId}]`), ...strs);

    if (abstract) {
      log(
        "Skipping",
        contractId,
        "because abstract contracts are not configurable"
      );
      continue;
    }

    let address = addresses[contractId];
    const contractFactory = await makeFactory(deployConfig, contractName);

    const contract = contractFactory.attach(address);

    let contractUnchanged = true;
    log(`Detecting config changes for ${contractId} (${address})`);

    let contractConfig = await getConfig(deployConfig, contractId, addresses);

    if (!contractConfig) {
      log(`No config found for ${contractId} skipping`);
      continue;
    }

    for (let [setterFunctionName, configParams] of Object.entries(
      contractConfig
    )) {
      let currentValues = await Promise.all(
        configParams.map(({ getter }) => retry(() => contract[getter]()))
      );

      let desiredValues = configParams.map((p) => p.value);

      if (
        currentValues.some(
          (v, i) => !isSolidityValuesEqual(v, desiredValues[i])
        )
      ) {
        contractUnchanged = false;
        log(
          `There are changes, need to call the setter function '${setterFunctionName}'`
        );

        let encodedCall = contract.interface.encodeFunctionData(
          setterFunctionName,
          desiredValues
        );

        await configChanged({
          contractId,
          encodedCall,
          upgradeManager,
          contract,
          pendingChanges,
          deployConfig,
          log,
        });
      }
    }

    if (contractUnchanged) {
      log(`no changes`);
    }
  }

  log(`
Completed configurations
`);
}

async function getConfig(
  deployConfig: DeployConfig,
  contractId: string,
  addresses: ContractAddressMap
) {
  let configPath = join(
    deployConfig.hre.config.paths.root,
    "config",
    contractId
  );

  if (!existsSync(configPath + ".ts") && !existsSync(configPath + ".js")) {
    return;
  }

  const { default: configFunction } = (await import(configPath)) as {
    default: ConfigFunction;
  };

  return await configFunction({
    addresses,
    address: (contractId: string) => {
      let address = addresses[contractId];
      if (!address) {
        throw new HardhatPluginError(
          PLUGIN_NAME,
          `Could not find address for contract ${contractId}, known addresses are ${Object.keys(
            addresses
          ).join(", ")}`
        );
      }
      return address;
    },
    deployConfig,
  });
}

async function configChanged({
  deployConfig,
  contractId,
  encodedCall,
  upgradeManager,
  pendingChanges,
  contract,
  log,
}: {
  deployConfig: DeployConfig;
  contractId: string;
  encodedCall: string;
  upgradeManager: UpgradeManager;
  pendingChanges: PendingChanges;
  contract: Contract;
  log: LogFunc;
}): Promise<void> {
  formatEncodedCall(contract, encodedCall)
    .split("\n")
    .map((s) => log(s));

  if (deployConfig.immediateConfigApply) {
    // if there are a large series of calls e.g. during initial setup, it might make more sense
    // to run this script as the owner and perform the config directly, if there are multiple calls for each
    // contract
    log("Immediate apply");
    await retryAndWaitForNonceIncrease(deployConfig, () =>
      upgradeManager.call(contractId, encodedCall)
    );
  } else {
    pendingChanges.encodedCalls[contractId] = encodedCall;
  }
}
