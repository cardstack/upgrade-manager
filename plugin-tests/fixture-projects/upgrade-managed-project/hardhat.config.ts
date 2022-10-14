// We load the plugin here.
import { HardhatUserConfig } from "hardhat/types";

import "../../../src/index";

import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";

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
    ],
  },
};

export default config;
