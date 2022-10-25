import { HardhatRuntimeEnvironment } from "hardhat/types";

export interface PendingChanges {
  newImplementations: {
    [contractId: string]: string;
  };
  encodedCalls: {
    [contractId: string]: string;
  };
}

export interface DeployConfigInput {
  hre: HardhatRuntimeEnvironment;
  network: string; // convenience for config.hre.network.name
  sourceNetwork: string;
  deployAddress?: string;
  forking: boolean;
  dryRun: boolean;
  autoConfirm: boolean;
  derivationPath?: string;
  mnemonic?: string;
  immediateConfigApply: boolean;
}

export interface DeployConfig extends DeployConfigInput {
  // Non-optional
  deployAddress: string;
}

export type DeployConfigMaybeWithoutDeployAddressYet =
  | DeployConfigInput
  | DeployConfig;

export type RetryCallback<T> = () => Promise<T>;

export type MetadataKey = "upgradeManagerAddress";

type SolidityPrimitive = string | number | boolean;
export type SolidityValue = SolidityPrimitive | Array<SolidityPrimitive>;

export interface ConfigParam {
  getter: string;
  value: SolidityValue;
}

export type ContractConfig = {
  [methodName: string]: Array<ConfigParam>;
};

interface ConfigFunctionArgs {
  addresses: ContractAddressMap;
  address: (contractId: string) => string;
  deployConfig: DeployConfig;
}
export type ConfigFunction = (
  args: ConfigFunctionArgs
) => Promise<ContractConfig>;

export interface ContractAddressMap {
  [contractId: string]: string;
}
