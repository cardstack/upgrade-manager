import { VoidSigner } from "@ethersproject/abstract-signer";
import { BaseProvider, JsonRpcProvider } from "@ethersproject/providers";
import { impersonateAccount } from "@nomicfoundation/hardhat-network-helpers";
import { getTransparentUpgradeableProxyFactory } from "@openzeppelin/hardhat-upgrades/dist/utils";
import { hashBytecodeWithoutMetadata } from "@openzeppelin/upgrades-core";
import colors from "colors/safe";
import { prompt } from "enquirer";
import { Contract, ContractFactory, Signer } from "ethers";
import { Interface } from "ethers/lib/utils";
import { existsSync, readFileSync } from "fs";
import { readJSONSync, writeJsonSync } from "fs-extra";
import { HardhatPluginError } from "hardhat/plugins";
import { Artifact, HardhatNetworkHDAccountsConfig } from "hardhat/types";
import { difference } from "lodash";
import lodashIsEqual from "lodash/isEqual";
import { join, resolve } from "path";
import TrezorWalletProvider from "trezor-cli-wallet-provider";
import { getErrorMessageAndStack } from "../shared";
import { UpgradeManager, UpgradeManager__factory } from "../typechain-types";

import {
  DeployConfig,
  DeployConfigMaybeWithoutDeployAddressYet,
  MetadataKey,
  RetryCallback,
  SolidityValue,
} from "./types";

export const PLUGIN_NAME = "upgrade-manager";

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
  let { network: sourceNetwork, hre, forking } = config;
  let deployAddress: string;

  if (config.deployAddress) {
    if (config.forking) {
      log(`Impersonating ${config.deployAddress}`);
      await impersonateAccount(config.deployAddress);
    }
    return config.deployAddress;
  }

  if (sourceNetwork === "hardhat") {
    if (!hre.ethers.getSigners) {
      throw new HardhatPluginError(
        PLUGIN_NAME,
        "Could not find ethers.getSigners, make sure you have @nomiclabs/hardhat-ethers installed correctly"
      );
    }
    let [signer] = await hre.ethers.getSigners();
    deployAddress = signer.address;
  } else if (sourceNetwork === "localhost") {
    deployAddress = getHardhatTestWallet(config).address;
  } else {
    deployAddress = await (await getSigner(config)).getAddress();
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

export async function getSigner(
  config: DeployConfigMaybeWithoutDeployAddressYet,
  address?: string
): Promise<Signer> {
  let {
    hre,
    forking,
    deployAddress,
    targetNetwork,
    network: sourceNetwork,
  } = config;

  if (sourceNetwork == "hardhat") {
    let addressForSigner = address || deployAddress;
    if (addressForSigner) {
      return config.hre.ethers.getSigner(
        addressForSigner
      ) as unknown as VoidSigner;
    } else {
      return (await config.hre.ethers.getSigners())[0];
    }
  }

  let rpcUrl = getRpcUrl(config);
  let derivationPath = config.derivationPath;

  const { chainId } = hre.network.config;

  if (targetNetwork === "localhost" && (!forking || address || deployAddress)) {
    let provider = hre.ethers.getDefaultProvider(
      "http://localhost:8545"
    ) as JsonRpcProvider;

    return provider.getSigner(
      address || deployAddress
    ) as unknown as VoidSigner;
  }

  if (config.mnemonic) {
    let provider = hre.ethers.getDefaultProvider(rpcUrl) as JsonRpcProvider;
    return hre.ethers.Wallet.fromMnemonic(
      config.mnemonic,
      config.derivationPath
    ).connect(provider) as unknown as VoidSigner;
  } else {
    log("No mnemonic found in config, using trezor");
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
      throw new HardhatPluginError(
        PLUGIN_NAME,
        `Nonce not increased yet for ${config.deployAddress}`
      );
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
    await delay(attempts * 1000);
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

  throw new HardhatPluginError(PLUGIN_NAME, "Reached max retry attempts");
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

  throw new HardhatPluginError(
    PLUGIN_NAME,
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
      let factory = await makeFactory(config, contractName);
      log(
        `Deploying proxy to ${contractName} with constructorArgs`,
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
      throw new HardhatPluginError(
        PLUGIN_NAME,
        `It failed, retrying\nError: ${message}`
      );
    }
  });
}

export async function makeFactory(
  config: DeployConfig,
  contractName: string
): Promise<ContractFactory> {
  let factory: ContractFactory;

  if (contractName == "upgradeManager") {
    factory = await getUpgradeManagerFactory(config);
  } else {
    factory = await config.hre.ethers.getContractFactory(contractName);
  }

  if (config.targetNetwork === "hardhat") {
    return factory;
  } else if (config.targetNetwork === "localhost" && !config.forking) {
    return factory.connect(getHardhatTestWallet(config));
  }

  return factory.connect(await getSigner(config));
}

async function getUpgradeManagerFactory(
  config: DeployConfig
): Promise<UpgradeManager__factory> {
  let { abi, bytecode } = readUpgradeManagerArtifactFromPlugin();
  return (await config.hre.ethers.getContractFactory(
    abi,
    bytecode,
    await getSigner(config)
  )) as UpgradeManager__factory;
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
    let UpgradeManager = await getUpgradeManagerFactory(config);

    if (!config.hre.upgrades) {
      throw new HardhatPluginError(
        PLUGIN_NAME,
        "Could not find hre.upgrades, make sure you have @openzeppelin/hardhat-upgrades installed correctly"
      );
    }

    let signer = UpgradeManager.signer;

    log("getting or deploying proxy admin");
    const adminAddress = await config.hre.upgrades.deployProxyAdmin(signer);
    log("admin address", adminAddress);

    let proxyAdmin = await getContractAtWithSignature(
      config,
      adminAddress,
      "owner() external view returns (address)"
    );

    let proxyAdminOwner = await proxyAdmin.owner();
    log("proxy admin owner", proxyAdminOwner);
    if (proxyAdminOwner !== config.deployAddress) {
      throw new Error(
        "Proxy admin is not owned by current deploy address, aborting"
      );
    }

    log("deploying implementation");
    let implementation = await retryAndWaitForNonceIncrease(
      config,
      async () => {
        let um = await UpgradeManager.deploy();
        await um.deployed();
        return um;
      }
    );
    log("implementation address", implementation.address);

    const TransparentUpgradeableProxyFactory =
      await getTransparentUpgradeableProxyFactory(config.hre, signer);

    log("deploying proxy");

    let proxy = await retryAndWaitForNonceIncrease(config, async () => {
      let px = await TransparentUpgradeableProxyFactory.deploy(
        implementation.address,
        proxyAdmin.address,
        encodeWithSignature(
          config,
          "initialize(address owner) external",
          config.deployAddress
        )
      );
      await px.deployed();
      return px;
    });

    log("Deployed upgrade manager proxy at", proxy.address);
    let upgradeManager = UpgradeManager.attach(proxy.address);

    let upgradeManagerOwner = await upgradeManager.owner();
    if (upgradeManagerOwner !== config.deployAddress) {
      throw new Error(
        "Upgrade manager not owned by current deploy address, aborting"
      );
    }

    log(
      `Adding deploy address ${config.deployAddress} as initial upgrade proposer`
    );
    await upgradeManager.addUpgradeProposer(config.deployAddress);

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
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `Could not find upgrade manager address in ${metadataPath(config)}`
    );
  }

  let signer;

  if (!readOnly) {
    signer = await getSigner(config);
  }
  let { abi } = readUpgradeManagerArtifactFromPlugin();

  return (await config.hre.ethers.getContractAt(
    abi,
    upgradeManagerAddress,
    signer
  )) as UpgradeManager;
}

function readUpgradeManagerArtifactFromPlugin(): Artifact {
  let path = join(__dirname, "../UpgradeManager.sol.json");
  if (!existsSync(path)) {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `Could not locate compiled UpgradeManager at ${path}, run yarn compile`
    );
  }
  let artifact: Artifact = JSON.parse(readFileSync(path, "utf-8"));

  return artifact;
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
    `upgrade-manager-deploy-data-${config.network}.json`
  );
}

export function asyncMain(main: { (...args: unknown[]): Promise<void> }): void {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export function getContractAtWithSignature(
  config: DeployConfig,
  address: string,
  signature: string
): Promise<Contract> {
  return config.hre.ethers.getContractAt([`function ${signature}`], address);
}

export function encodeWithSignature(
  config: DeployConfig,
  signature: string,
  ...args: unknown[]
): string {
  let iface = new config.hre.ethers.utils.Interface([`function ${signature}`]);
  return iface.encodeFunctionData(signature, args);
}

export function isSolidityValuesEqual(val1: unknown, val2: unknown): boolean {
  if (Array.isArray(val1) && Array.isArray(val2)) {
    return (
      difference(val1, val2).length === 0 && difference(val2, val1).length === 0
    );
  }
  return lodashIsEqual(val1, val2);
}

export function formatEncodedCall(
  contract: Contract | ContractFactory,
  encodedCall: string
): string {
  return formatEncodedCallWithInterface(contract.interface, encodedCall);
}

export function formatEncodedCallWithInterface(
  iface: Interface,
  encodedCall: string
): string {
  let tx = iface.parseTransaction({ data: encodedCall });
  let {
    functionFragment: { name, inputs },
    args,
  } = tx;

  function format(arg: unknown) {
    return JSON.stringify(arg);
  }
  let formattedArgs = inputs.map(
    (input, i) => `\n  ${input.type} ${input.name || ""}: ${format(args[i])}`
  );

  return `${name}(${formattedArgs.join()}\n)`;
}
