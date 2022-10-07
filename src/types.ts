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
  sourceNetwork: string;
  targetNetwork: string;
  deployAddress?: string;
  forking: boolean;
  dryRun: boolean;
  derivationPath?: string;
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
