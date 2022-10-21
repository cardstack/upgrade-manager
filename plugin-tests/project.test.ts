import { expect } from "chai";

// import { ExampleHardhatRuntimeEnvironmentField } from "../src/ExampleHardhatRuntimeEnvironmentField";

import { AddressZero } from "@ethersproject/constants";

import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersHelpers } from "@nomiclabs/hardhat-ethers/types";
import { HardhatUpgrades } from "@openzeppelin/hardhat-upgrades";
import Table from "cli-table3";
import { ethers } from "ethers";
import { sortBy } from "lodash";
import {
  CREATE2_PROXY_DEPLOYMENT_COST,
  CREATE2_PROXY_DEPLOYMENT_SIGNER_ADDRESS,
  deployCreate2Contract,
  deployCreate2Proxy,
} from "../src/create2";
import "../src/type-extensions";
import {
  getFixtureProjectUpgradeManager,
  runTask,
  setupCreate2Proxy,
  useEnvironment,
  writeFixtureProjectFile,
} from "./helpers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

declare module "hardhat/types/runtime" {
  interface HardhatRuntimeEnvironment {
    // We omit the ethers field because it is redundant.
    ethers: typeof ethers & HardhatEthersHelpers;
    upgrades: HardhatUpgrades;
  }
}

const AbstractContractZeroSaltCreate2Address =
  "0xe8C4B6c633191414078A38ef86d1b90cF675d71d";
const AbstractContractOneSaltCreate2Address =
  "0xEDC101497331C535E5868D910deE15D6aBEC51F1";

describe("Basic project setup", function () {
  this.timeout(60000);
  // describe("Sample for Hardhat Runtime Environment extension", function () {
  //   useEnvironment("upgrade-managed-project");

  //   it("Should add the example field", function () {
  //     assert.instanceOf(
  //       this.hre.example,
  //       ExampleHardhatRuntimeEnvironmentField
  //     );
  //   });

  //   it("The example filed should say hello", function () {
  //     assert.equal(this.hre.example.sayHello(), "hello");
  //   });
  // });

  useEnvironment("upgrade-managed-project");

  it("Should add the contract init spec to the config", function () {
    // Note: if config tests are failing, check for requiring app code from the test helpers, that can cause
    // problems with the hre here being the plugin's default HRE not the fixture environment hre
    expect(this.hre.config.upgradeManager.contracts).to.deep.equal([
      {
        id: "MockUpgradeableContract",
        contract: "MockUpgradeableContract",
        abstract: false,
        deterministic: false,
      },
      {
        abstract: false,
        deterministic: false,
        id: "MockUpgradeableSecondInstance",
        contract: "MockUpgradeableContract",
      },
      {
        contract: "MockUpgradeableContract",
        id: "ContractWithNoConfig",
        abstract: false,
        deterministic: false,
      },
      {
        id: "AbstractContract",
        contract: "AbstractContract",
        abstract: true,
        deterministic: false,
      },
      {
        id: "DeterministicContract",
        contract: "AbstractContract",
        abstract: true,
        deterministic: true,
      },
      {
        abstract: true,
        contract: "AbstractContract",
        deterministic:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        id: "DeterministicContractDifferentSalt",
      },
    ]);
  });

  it("Should deploy and upgrade contracts", async function () {
    await setupCreate2Proxy(this.hre);

    await expect(runTask(this.hre, "deploy:status")).to.be.rejectedWith(
      /Could not find upgrade manager address/
    );

    let { stdout } = await runTask(this.hre, "deploy");
    expect(stdout).to.include("Deploying to --network hardhat");
    expect(stdout).to.include(
      "Deploying from 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    );

    expect(stdout).to.include("Deployed upgrade manager proxy at");
    expect(stdout).to.include("Deployed new proxy for MockUpgradeableContract");
    expect(stdout).to.include(
      "Deployed new proxy for MockUpgradeableSecondInstance"
    );
    expect(stdout).to.include(
      "Deployed new abstract contract AbstractContract (AbstractContract) to 0x"
    );

    let upgradeManager = await getFixtureProjectUpgradeManager(this);
    expect(await upgradeManager.owner()).to.eq(
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    );

    expect(
      await upgradeManager.adoptedContractAddresses("unknown contract")
    ).to.eq(AddressZero);

    let mockUpgradeableContractAddress =
      await upgradeManager.adoptedContractAddresses("MockUpgradeableContract");
    expect(mockUpgradeableContractAddress).not.to.eq(AddressZero);

    let mockUpgradeableSecondInstanceAddress =
      await upgradeManager.adoptedContractAddresses(
        "MockUpgradeableSecondInstance"
      );

    expect(mockUpgradeableSecondInstanceAddress).not.to.eq(AddressZero);

    let mockUpgradeableContract = await this.hre.ethers.getContractAt(
      "MockUpgradeableContract",
      mockUpgradeableContractAddress
    );
    let mockUpgradeableSecondInstance = await this.hre.ethers.getContractAt(
      "MockUpgradeableContract",
      mockUpgradeableSecondInstanceAddress
    );

    expect(stdout).to.include("No config found for ContractWithNoConfig");
    expect(stdout).to.include("Proposing call for MockUpgradeableContract");
    expect(stdout).to.include(
      "Proposing call for MockUpgradeableSecondInstance"
    );
    expect(stdout).not.to.include("Proposing call for ContractWithNoConfig");

    expect(await mockUpgradeableContract.fooString()).to.eq("");
    expect(await mockUpgradeableSecondInstance.fooString()).to.eq("");

    expect(await mockUpgradeableContract.barAddress()).to.eq(AddressZero);
    expect(await mockUpgradeableSecondInstance.barAddress()).to.eq(AddressZero);

    ({ stdout } = await runTask(this.hre, "deploy:upgrade", {
      newVersion: "1.0",
      autoConfirm: true,
    }));

    expect(await mockUpgradeableContract.fooString()).to.eq("foo string value");
    // Check it contains the current network value i.e. can be dynamic
    expect(await mockUpgradeableSecondInstance.fooString()).to.eq(
      "foo string value second hardhat"
    );

    expect(await mockUpgradeableContract.barAddress()).to.eq(
      mockUpgradeableSecondInstanceAddress
    );
    expect(await mockUpgradeableSecondInstance.barAddress()).to.eq(
      mockUpgradeableContractAddress
    );

    expect(await upgradeManager.version()).to.eq("1.0");

    let abstractContractAddress =
      await upgradeManager.getAbstractContractAddress("AbstractContract");

    let implAddress = await this.hre.upgrades.erc1967.getImplementationAddress(
      mockUpgradeableContract.address
    );

    expect(await getStatusTable(this.hre)).to.deep.eq([
      [
        "AbstractContract",
        "AbstractContract",
        null,
        abstractContractAddress,
        null,
        null,
        null,
      ],
      [
        "ContractWithNoConfig",
        "MockUpgradeableContract",
        await upgradeManager.adoptedContractAddresses("ContractWithNoConfig"),
        implAddress,
        null,
        null,
        null,
      ],
      [
        "DeterministicContract",
        "AbstractContract",
        null,
        AbstractContractZeroSaltCreate2Address,
        null,
        null,
        null,
      ],
      [
        "DeterministicContractDifferentSalt",
        "AbstractContract",
        null,
        AbstractContractOneSaltCreate2Address,
        null,
        null,
        null,
      ],
      [
        "MockUpgradeableContract",
        "MockUpgradeableContract",
        mockUpgradeableContract.address,
        implAddress,
        null,
        null,
        null,
      ],
      [
        "MockUpgradeableSecondInstance",
        "MockUpgradeableContract",
        mockUpgradeableSecondInstance.address,
        implAddress,
        null,
        null,
        null,
      ],
    ]);

    writeFixtureProjectFile(
      "contracts/AbstractContract.sol",
      `
      pragma solidity ^0.8.17;
      pragma abicoder v1;

      contract AbstractContract {
        function version() external pure returns (string memory) {
          return "2";
        }
      }`
    );

    expect(await getStatusTable(this.hre)).to.deep.eq([
      [
        "AbstractContract",
        "AbstractContract",
        null,
        abstractContractAddress,
        null,
        null,
        "YES",
      ],
      [
        "ContractWithNoConfig",
        "MockUpgradeableContract",
        await upgradeManager.adoptedContractAddresses("ContractWithNoConfig"),
        implAddress,
        null,
        null,
        null,
      ],
      [
        "DeterministicContract",
        "AbstractContract",
        null,
        AbstractContractZeroSaltCreate2Address,
        null,
        null,
        "YES",
      ],
      [
        "DeterministicContractDifferentSalt",
        "AbstractContract",
        null,
        AbstractContractOneSaltCreate2Address,
        null,
        null,
        "YES",
      ],
      [
        "MockUpgradeableContract",
        "MockUpgradeableContract",
        mockUpgradeableContract.address,
        implAddress,
        null,
        null,
        null,
      ],
      [
        "MockUpgradeableSecondInstance",
        "MockUpgradeableContract",
        mockUpgradeableSecondInstance.address,
        implAddress,
        null,
        null,
        null,
      ],
    ]);

    ({ stdout } = await runTask(this.hre, "deploy:diff:local", {
      compare: "local",
      contractId: "AbstractContract",
    }));
  });

  describe("CREATE2", function () {
    it("deploys the create2 proxy and a contract at a known address", async function () {
      setBalance(
        CREATE2_PROXY_DEPLOYMENT_SIGNER_ADDRESS,
        CREATE2_PROXY_DEPLOYMENT_COST
      );
      expect(await deployCreate2Proxy(this.hre.ethers.provider)).to.be.true;
      // Second time should not redeploy and return false
      expect(await deployCreate2Proxy(this.hre.ethers.provider)).to.be.false;
      let factory = await this.hre.ethers.getContractFactory(
        "AbstractContract"
      );
      factory.bytecode;

      let contractAddress = await deployCreate2Contract({
        signer: this.hre.ethers.provider.getSigner(),
        bytecode: factory.bytecode,
      });

      expect(await factory.attach(contractAddress).version()).to.eq("1");
    });
  });

  it("calls the task again and verifies no changes");
  it("tests upgrade");
  it("tests call");

  it("Audit TODOs");
  it("Audit process.env");
  it("deploys owned by safe");
  it("https://github.com/thegostep/solidity-create2-deployer");
  it("https://github.com/Arachnid/deterministic-deployment-proxy");
  it(
    "builds artifact and populates with npm publish readUpgradeManagerArtifactFromPlugin"
  );
  it("audit Error classes - should be plugin error");
  it("supports setting init args when initially deploying");
  it("allows adding proposer");
  it("stores the deploy meta in a subdirectory");
  it("handles bignum and bool");
  it("handles verification");
  it("audit dryRun");
  it("process.env.IMMEDIATE_CONFIG_APPLY");
  it("handles changing from abstract to proxy and back");
  it("safe");
});

async function getStatusTable(
  hre: HardhatRuntimeEnvironment
): Promise<
  (Table.HorizontalTableRow | Table.VerticalTableRow | Table.CrossTableRow)[]
> {
  let { result } = await runTask<{ table: Table.Table; anyChanged: boolean }>(
    hre,
    "deploy:status",
    {
      quiet: true,
    }
  );

  if (!result) {
    throw "missing result";
  }
  return sortBy(result.table, (r) => (r as string[])[0]);
}
// describe("Unit tests examples", function () {
//   describe("ExampleHardhatRuntimeEnvironmentField", function () {
//     describe("sayHello", function () {
//       it("Should say hello", function () {
//         const field = new ExampleHardhatRuntimeEnvironmentField();
//         assert.equal(field.sayHello(), "hello");
//       });
//     });
//   });
// });
