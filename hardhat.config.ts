import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "./src/hardhat-error-on-compiler-warnings";
import "hardhat-contract-sizer";

import { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.17",
      },
    ],

    overrides: {
      "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol": {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
          },
        },
      },
    },
  },
};

export default config;
