import { expect } from "chai";

// import { ExampleHardhatRuntimeEnvironmentField } from "../src/ExampleHardhatRuntimeEnvironmentField";

import { AddressZero } from "@ethersproject/constants";

import "../src/type-extensions";
import {
  getFixtureProjectUpgradeManager,
  runTask,
  useEnvironment,
} from "./helpers";
import { ethers } from "ethers";
import { HardhatEthersHelpers } from "@nomiclabs/hardhat-ethers/types";

declare module "hardhat/types/runtime" {
  interface HardhatRuntimeEnvironment {
    // We omit the ethers field because it is redundant.
    ethers: typeof ethers & HardhatEthersHelpers;
  }
}

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
        singleton: false,
      },
      {
        singleton: false,
        id: "MockUpgradeableSecondInstance",
        contract: "MockUpgradeableContract",
      },
      {
        contract: "MockUpgradeableContract",
        id: "ContractWithNoConfig",
        singleton: false,
      },
    ]);
  });

  it("Should deploy and upgrade contracts", async function () {
    await expect(
      runTask(this.hre, "deploy:status", {
        deployNetwork: "hardhat",
      })
    ).to.be.rejectedWith(/Could not find upgrade manager address/);

    let { stdout } = await runTask(this.hre, "deploy", {
      deployNetwork: "hardhat",
    });
    expect(stdout).to.include("Deploying to hardhat");
    expect(stdout).to.include(
      "Deploying from 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    );

    expect(stdout).to.include("Deployed upgrade manager proxy at");
    expect(stdout).to.include("Deployed new proxy for MockUpgradeableContract");
    expect(stdout).to.include(
      "Deployed new proxy for MockUpgradeableSecondInstance"
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

    ({ stdout } = await runTask(this.hre, "deploy:execute", {
      deployNetwork: "hardhat",
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
  });

  it("calls the task again and verifies no changes");

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
});

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
