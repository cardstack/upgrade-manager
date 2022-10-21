import Table from "cli-table3";

import {
  deployedCodeMatches,
  deployedImplementationMatches,
  formatEncodedCall,
  getSourceProvider,
  getUpgradeManager,
  log,
  PLUGIN_NAME,
} from "./util";

import { AddressZero } from "@ethersproject/constants";
import { HardhatPluginError } from "hardhat/plugins";
import { UpgradeManagerContractConfig } from "hardhat/types";
import { DeployConfig } from "./types";

export async function diff(
  config: DeployConfig,
  contractName: string,
  compare: "local" | "proposed" = "local"
) {}
