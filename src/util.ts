import rootHre from "hardhat";
import { VoidSigner } from "@ethersproject/abstract-signer";
import { BaseProvider, JsonRpcProvider } from "@ethersproject/providers";
import { hashBytecodeWithoutMetadata } from "@openzeppelin/upgrades-core";
import colors from "colors/safe";
import { prompt } from "enquirer";
import { Contract, ContractFactory } from "ethers";
import { existsSync } from "fs";
import { readJSONSync, writeJsonSync } from "fs-extra";
import { HardhatNetworkHDAccountsConfig } from "hardhat/types";
import { resolve } from "path";
import TrezorWalletProvider from "trezor-cli-wallet-provider";
import {
  DeployConfig,
  DeployConfigMaybeWithoutDeployAddressYet,
  MetadataKey,
  RetryCallback,
} from "./types";
import { UpgradeManager } from "../typechain-types";

export function log(...strs: string[]) {
  console.log(colors.blue(`[Deploy]`), ...strs);
}

export async function confirm(message: string): Promise<boolean> {
  if (process.env.CARDSTACK_AUTOCONFIRM == "true") {
    return true;
  }

  let { question } = (await prompt({
    type: "confirm",
    name: "question",
    message,
  })) as { question: boolean };

  return question;
}

export async function getDeployAddress(
  config: DeployConfigMaybeWithoutDeployAddressYet
): Promise<string> {
  let { sourceNetwork, hre, forking } = config;
  let deployAddress: string;

  if (config.deployAddress) {
    if (config.forking) {
      log(`Impersonating ${config.deployAddress}`);
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [config.deployAddress],
      });
    }
    return config.deployAddress;
  }

  if (sourceNetwork === "hardhat") {
    let [signer] = await hre.ethers.getSigners();
    deployAddress = signer.address;
  } else if (sourceNetwork === "localhost") {
    deployAddress = getHardhatTestWallet(config).address;
  } else {
    deployAddress = await getSigner(config).getAddress();
    if (
      !forking &&
      !(await confirm(
        `Send transactions from address ${deployAddress}? (No further confirmations for mnemnonic-derived addresses)`
      ))
    ) {
      process.exit(1);
    }
  }

  config.deployAddress = deployAddress;

  return deployAddress;
}

function getHardhatTestWallet({
  hre,
}: DeployConfigMaybeWithoutDeployAddressYet) {
  let provider = hre.ethers.getDefaultProvider("http://localhost:8545");

  let accounts = hre.config.networks.hardhat.accounts;
  const { mnemonic } = accounts as HardhatNetworkHDAccountsConfig;

  // This is the default hardhat test mnemonic
  let wallet = hre.ethers.Wallet.fromMnemonic(
    mnemonic || "test test test test test test test test test test test junk"
  );
  return wallet.connect(provider);
}

// VoidSigner is the same as Signer but implements TypedDataSigner interface
export function getSigner(
  deployConfig: DeployConfigMaybeWithoutDeployAddressYet,
  address?: string
): VoidSigner {
  let { hre, forking, deployAddress, targetNetwork } = deployConfig;

  let rpcUrl = getRpcUrl(deployConfig);
  let derivationPath = deployConfig.derivationPath;

  const { chainId } = hre.network.config;

  if (targetNetwork === "localhost" && (!forking || address || deployAddress)) {
    let provider = hre.ethers.getDefaultProvider(
      "http://localhost:8545"
    ) as JsonRpcProvider;

    return provider.getSigner(
      address || deployAddress
    ) as unknown as VoidSigner;
  }

  if (process.env.DEPLOY_MNEMONIC) {
    let provider = hre.ethers.getDefaultProvider(rpcUrl) as JsonRpcProvider;
    return hre.ethers.Wallet.fromMnemonic(
      process.env.DEPLOY_MNEMONIC,
      deployConfig.derivationPath
    ).connect(provider) as unknown as VoidSigner;
  } else {
    log("No DEPLOY_MNEMONIC found, using trezor");
    const walletProvider = new TrezorWalletProvider(rpcUrl, {
      chainId: chainId,
      numberOfAccounts: 3,
      derivationPath,
    });
    let trezorProvider = new hre.ethers.providers.Web3Provider(
      walletProvider,
      targetNetwork
    );
    return trezorProvider.getSigner(address) as unknown as VoidSigner;
  }
}

// This waits for nonce increase after doing a transaction to prevent the next
// transaction having the wrong nonce
export async function retryAndWaitForNonceIncrease<T>(
  config: DeployConfig,
  cb: RetryCallback<T>,
  maxAttempts = 10
): Promise<T> {
  let oldNonce = await config.hre.ethers.provider.getTransactionCount(
    config.deployAddress
  );

  let result = await retry(cb, maxAttempts);
  await retry(async () => {
    if (
      (await config.hre.ethers.provider.getTransactionCount(
        config.deployAddress
      )) === oldNonce
    ) {
      throw new Error(`Nonce not increased yet for ${config.deployAddress}`);
    }
  });
  return result;
}

export async function retry<T>(
  cb: RetryCallback<T>,
  maxAttempts = 10
): Promise<T> {
  let attempts = 0;
  do {
    await delay(1000 + attempts * 1000);
    try {
      attempts++;
      return await cb();
    } catch (e) {
      let { message, stack } = getErrorMessageAndStack(e);

      log(
        `received ${message}, trying again (${attempts} of ${maxAttempts} attempts)`
      );

      if (stack) {
        log(stack);
      }
    }
  } while (attempts < maxAttempts);

  throw new Error("Reached max retry attempts");
}

export function getErrorMessageAndStack(error: unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error) return error;
  return { message: String(error), stack: new Error().stack };
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deployedCodeMatches(
  deployConfig: DeployConfig,
  contractName: string,
  proxyAddress: string
): Promise<boolean> {
  let currentImplementationAddress =
    await deployConfig.hre.upgrades.erc1967.getImplementationAddress(
      proxyAddress
    );
  log(
    `Checking implementation of ${contractName}@${proxyAddress} (curent implementation: ${currentImplementationAddress})`
  );

  return await deployedImplementationMatches(
    deployConfig,
    contractName,
    currentImplementationAddress
  );
}

export async function deployedImplementationMatches(
  config: DeployConfig,
  contractName: string,
  implementationAddress: string
): Promise<boolean> {
  let artifact = await config.hre.artifacts.readArtifact(contractName);

  let deployedCode = await getProvider(config).getCode(implementationAddress);
  if (!deployedCode || deployedCode === "0x") {
    return false;
  }

  let deployedCodeHash = hashBytecodeWithoutMetadata(deployedCode);
  let localCodeHash = hashBytecodeWithoutMetadata(artifact.deployedBytecode);

  log(
    `On chain code hash at ${implementationAddress} (without metadata): ${deployedCodeHash}`
  );

  log(`Local bytecode hash (without metadata): ${localCodeHash}`);

  return deployedCodeHash === localCodeHash;
}

export function getProvider(config: DeployConfig): BaseProvider {
  return config.hre.ethers.getDefaultProvider(getRpcUrl(config));
}

function getRpcUrl(
  deployConfig: DeployConfigMaybeWithoutDeployAddressYet
): string {
  const networkConfig = deployConfig.hre.network.config;
  if ("url" in networkConfig) {
    return networkConfig.url;
  }

  throw new Error(
    `Could not determine rpc url from network config ${JSON.stringify(
      networkConfig,
      null,
      2
    )}`
  );
}

export async function deployNewProxyAndImplementation(
  config: DeployConfig,
  contractName: string,
  constructorArgs: unknown[]
): Promise<Contract> {
  return await retry(async () => {
    try {
      log(`Creating factory`);
      let factory = await makeFactory(config, contractName);
      log(
        `Deploying proxy with constructorArgs`,
        JSON.stringify(constructorArgs, null, 2)
      );
      let instance = await config.hre.upgrades.deployProxy(
        factory,
        constructorArgs
      );
      log("Waiting for transaction");
      await instance.deployed();
      return instance;
    } catch (e) {
      const { message } = getErrorMessageAndStack(e);
      throw new Error(`It failed, retrying\nError: ${message}`);
    }
  });
}

export async function makeFactory(
  config: DeployConfig,
  contractName: string
): Promise<ContractFactory> {
  if (config.targetNetwork === "hardhat") {
    return await config.hre.ethers.getContractFactory(contractName);
  } else if (config.targetNetwork === "localhost" && !config.forking) {
    return (await config.hre.ethers.getContractFactory(contractName)).connect(
      getHardhatTestWallet(config)
    );
  }

  return (await config.hre.ethers.getContractFactory(contractName)).connect(
    getSigner(config)
  );
}

export async function getOrDeployUpgradeManager(
  config: DeployConfig
): Promise<Contract> {
  if (readMetadata(config, "upgradeManagerAddress")) {
    let upgradeManager = await getUpgradeManager(config);
    let nonce = await upgradeManager.nonce(); // Sanity check that it's a real contract
    log(
      `Found existing upgrade manager at ${upgradeManager.address}, nonce ${nonce}`
    );
    return upgradeManager;
  } else {
    log(`Deploying new upgrade manager`);
    let UpgradeManager = await makeFactory(config, "UpgradeManager");

    // TODO: safe ownership
    let upgradeManager = await config.hre.upgrades.deployProxy(UpgradeManager, [
      config.deployAddress,
    ]);
    await upgradeManager.deployed();

    log(`Deployed new upgrade manager to ${upgradeManager.address}`);
    writeMetadata(config, "upgradeManagerAddress", upgradeManager.address);
    return upgradeManager;
  }
}

export async function getUpgradeManager(
  config: DeployConfig,
  readOnly = false
): Promise<UpgradeManager> {
  let upgradeManagerAddress = readMetadata(config, "upgradeManagerAddress");
  if (!upgradeManagerAddress) {
    throw new Error(
      `Could not find upgrade manager address in ${metadataPath(config)}`
    );
  }

  let signer;

  if (!readOnly) {
    signer = getSigner(config);
  }
  let { abi } = readUpgradeManagerArtifactFromPlugin();

  return (await config.hre.ethers.getContractAt(
    abi,
    upgradeManagerAddress,
    signer
  )) as UpgradeManager;
}

function readUpgradeManagerArtifactFromPlugin() {
  console.log(rootHre);
  let abi: unknown[] = [];
  return { abi };
}

export function readMetadata(
  config: DeployConfig,
  key: MetadataKey
): string | undefined {
  let path = metadataPath(config);
  if (existsSync(path)) {
    return readJSONSync(path)[key];
  }
}
export function writeMetadata(
  config: DeployConfig,
  key: "upgradeManagerAddress",
  value: string
): void {
  let path = metadataPath(config);

  let metadata: { [k: string]: string } = {};
  if (existsSync(path)) {
    metadata = readJSONSync(path);
  }

  metadata[key] = value;

  writeJsonSync(path, metadata);
}

function metadataPath(config: DeployConfig): string {
  return resolve(
    config.hre.config.paths.root,
    `upgrade-manager-deploy-data-${config.sourceNetwork}.json`
  );
}
