// We load the plugin here.
import { HardhatUserConfig } from "hardhat/types";

import "../../../src/index";

import "@nomiclabs/hardhat-ethers";

const config: HardhatUserConfig = {
  solidity: "0.8.17",
  defaultNetwork: "hardhat",
  upgradeManager: {
    contracts: [
      "MockUpgradeableContract",
      {
        id: "MockUpgradeableSecondInstance",
        contract: "MockUpgradeableContract",
      },
      {
        id: "ContractWithNoConfig",
        contract: "MockUpgradeableContract",
      },
      {
        id: "AbstractContract",
        abstract: true,
      },
      {
        id: "DeterministicContract",
        contract: "AbstractContract",
        abstract: true,
        deterministic: true,
      },
      {
        id: "DeterministicContractDifferentSalt",
        contract: "AbstractContract",
        abstract: true,
        deterministic:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
      },
    ],
  },
};

export default config;
