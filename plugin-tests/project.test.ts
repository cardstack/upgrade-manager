import { expect } from "chai";

// import { ExampleHardhatRuntimeEnvironmentField } from "../src/ExampleHardhatRuntimeEnvironmentField";

import { captureOutput, runTask, useEnvironment } from "./helpers";
import "../src/type-extensions";

describe("Basic project setup", function () {
  // describe("Hardhat Runtime Environment extension", function () {
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

  it.only("Should add the contract init spec to the config", function () {
    console.log(this.hre.config);
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
    ]);
  });

  it("Should show the initial status", async function () {
    let { stdout } = await runTask(this.hre, "deploy:status");

    expect(stdout).to.include("Deploy status");
  });

  it("Should deploy a mock contract", async function () {
    let { stdout } = await runTask(this.hre, "deploy", {
      deployNetwork: "hardhat",
    });
    expect(stdout).to.include("Deploying to hardhat");
    // TODO
    console.log(stdout);
    expect(stdout).to.include(
      "Deploying from 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    );
  });

  it("Audit TODOs");
  it("Audit process.env");
  it("deploys owned by safe");
  it("https://github.com/thegostep/solidity-create2-deployer");
  it(
    "builds artifact and populates with npm publish readUpgradeManagerArtifactFromPlugin"
  );
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
