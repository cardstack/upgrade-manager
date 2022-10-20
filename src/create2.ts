import {
  BaseProvider,
  Provider,
  TransactionResponse,
} from "@ethersproject/providers";
import { BigNumber, Signer } from "ethers";
import { concat, hexDataLength, isHexString } from "ethers/lib/utils";
import { HardhatPluginError } from "hardhat/plugins";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { PLUGIN_NAME } from "./util";

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
      `CREATE2 bytecode is not deployed to contract address ${CREATE2_PROXY_ADDRESS}`
    );
  } else {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `Unexpected CREATE2 proxy code, this should never happen, something is very wrong`
    );
  }
}

export async function deployCreate2Contract({
  signer,
  bytecode,
  salt = EMPTY_BYTES_32,
}: {
  signer: Signer;
  bytecode: string;
  salt?: string;
}): Promise<string> {
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
      "Salt must be a valid 0x prefixed 32 byte hex string"
    );
  }

  let txParams = {
    to: CREATE2_PROXY_ADDRESS,
    data: concat([salt, bytecode]),
  };

  let contractAddress = await signer.call(txParams);

  let tx = await signer.sendTransaction(txParams);

  await tx.wait();

  return contractAddress;
}
