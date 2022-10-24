import { Provider } from "@ethersproject/providers";
import { BigNumber, Signer } from "ethers";
import {
  concat,
  defaultAbiCoder,
  getAddress,
  getCreate2Address as ethersGetCreate2Address,
  hexDataLength,
  keccak256,
  ParamType,
} from "ethers/lib/utils";
import { HardhatPluginError } from "hardhat/plugins";

import { log, PLUGIN_NAME } from "./util";

// Source: https://github.com/Arachnid/deterministic-deployment-proxy (https://archive.ph/wip/yQGLQ)
// Related Reading: https://weka.medium.com/how-to-send-ether-to-11-440-people-187e332566b7 (https://archive.ph/wip/o90Bf)
export const CREATE2_PROXY_DEPLOYMENT_TRANSACTION =
  "0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222";

export const CREATE2_PROXY_BYTECODE =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

// This comes from choosing arbitrary signature values until a valid set is found (~50%?) then running
// ecrecover on them and storing the signer address
export const CREATE2_PROXY_DEPLOYMENT_SIGNER_ADDRESS =
  "0x3fab184622dc19b6109349b94811493bf2a45362";

export const CREATE2_PROXY_DEPLOYMENT_GAS_PRICE =
  BigNumber.from("100000000000");

export const CREATE2_PROXY_DEPLOYMENT_GAS_LIMIT = BigNumber.from("100000");

export const CREATE2_PROXY_DEPLOYMENT_COST =
  CREATE2_PROXY_DEPLOYMENT_GAS_PRICE.mul(CREATE2_PROXY_DEPLOYMENT_GAS_LIMIT);

export const CREATE2_PROXY_ADDRESS =
  "0x4e59b44847b379578588920ca78fbf26c0b4956c";

export const EMPTY_BYTES_32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export async function deployCreate2Proxy(provider: Provider): Promise<boolean> {
  try {
    await validateCreate2Bytecode(provider);
    return false; // no deployment needed
  } catch (e) {
    // bytecode not correct, deploy needed
  }

  let balance = await provider.getBalance(
    CREATE2_PROXY_DEPLOYMENT_SIGNER_ADDRESS
  );

  if (balance.lt(CREATE2_PROXY_DEPLOYMENT_COST)) {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `One-time-use deployment account ${CREATE2_PROXY_DEPLOYMENT_SIGNER_ADDRESS} does not have enough balance to deploy CREATE2 proxy`
    );
  }

  const { hash } = await provider.sendTransaction(
    CREATE2_PROXY_DEPLOYMENT_TRANSACTION
  );
  await provider.waitForTransaction(hash);

  await validateCreate2Bytecode(provider);

  return true;
}

async function validateCreate2Bytecode(provider: Provider) {
  let code = await provider.getCode(CREATE2_PROXY_ADDRESS);

  if (code == CREATE2_PROXY_BYTECODE) {
    return;
  } else if (code == "0x") {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `CREATE2 proxy bytecode is not deployed to contract address ${CREATE2_PROXY_ADDRESS}`
    );
  } else {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `Unexpected CREATE2 proxy code, this should never happen, something is very wrong`
    );
  }
}

export type ContractInfo = {
  bytecode: string;
  salt?: string;
  constructorArgs?: [(string | ParamType)[], unknown[]];
};

export function getCreate2Address({
  bytecode,
  constructorArgs = [[], []],
  salt = EMPTY_BYTES_32,
}: ContractInfo): string {
  let encodedConstructorArgs = encodeConstructorArgs(constructorArgs);

  let initCodeHash = keccak256(concat([bytecode, encodedConstructorArgs]));

  return ethersGetCreate2Address(CREATE2_PROXY_ADDRESS, salt, initCodeHash);
}

export async function deployCreate2Contract({
  signer,
  bytecode,
  constructorArgs = [[], []],
  salt = EMPTY_BYTES_32,
}: ContractInfo & { signer: Signer }): Promise<string> {
  if (!signer.provider) {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      "this signer does not have a provider"
    );
  }
  await validateCreate2Bytecode(signer.provider);

  if (hexDataLength(salt) != 32) {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `Salt must be a valid 0x prefixed 32 byte hex string, but it was "${salt}" of length ${hexDataLength(
        salt
      )}`
    );
  }

  let expectedAddress = getCreate2Address({ bytecode, salt, constructorArgs });

  let encodedConstructorArgs = encodeConstructorArgs(constructorArgs);
  let existingCode = await signer.provider.getCode(expectedAddress);
  if (existingCode != "0x") {
    log(`Contract already exists at ${expectedAddress}`);
    return expectedAddress;
  }

  let txParams = {
    to: CREATE2_PROXY_ADDRESS,
    data: concat([salt, bytecode, encodedConstructorArgs]),
  };

  let contractAddress = getAddress(await signer.call(txParams));

  if (contractAddress != expectedAddress) {
    throw new Error(
      `The contract would not be deployed at the expected CREATE2 address ${expectedAddress} but instead ${contractAddress}`
    );
  }

  let tx = await signer.sendTransaction(txParams);

  await tx.wait();

  return contractAddress;
}

function encodeConstructorArgs(
  constructorArgs: [(string | ParamType)[], unknown[]]
) {
  return constructorArgs[0].length
    ? defaultAbiCoder.encode(constructorArgs[0], constructorArgs[1])
    : "0x";
}
