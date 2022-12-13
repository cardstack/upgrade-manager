// import { ExampleHardhatRuntimeEnvironmentField } from "../src/ExampleHardhatRuntimeEnvironmentField";

import { AddressZero } from "@ethersproject/constants";
import { SafeSignature } from "@gnosis.pm/safe-contracts";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersHelpers } from "@nomiclabs/hardhat-ethers/types";
import { HardhatUpgrades } from "@openzeppelin/hardhat-upgrades";
import { expect } from "chai";
import Table from "cli-table3";
import { Contract, ethers } from "ethers";
import { getAddress } from "ethers/lib/utils";
import {
  HardhatRuntimeEnvironment,
  UpgradeManagerContractConfig,
} from "hardhat/types";
import { sortBy } from "lodash";

import { readArtifactFromPlugin } from "../shared";
import {
  CREATE2_PROXY_DEPLOYMENT_COST,
  CREATE2_PROXY_DEPLOYMENT_SIGNER_ADDRESS,
  deployCreate2Contract,
  deployCreate2Proxy,
  getCreate2Address,
} from "../src/create2";
import { encodePriorSignatures } from "../src/safe";
import "../src/type-extensions";
import { GnosisSafe } from "../typechain-types";

import {
  deployGnosisSafeProxyFactoryAndSingleton,
  getFixtureProjectUpgradeManager,
  HardhatFirstAddress,
  HardhatSecondAddress,
  runTask,
  setupCreate2Proxy,
  useEnvironment,
  writeFixtureProjectFile,
} from "./helpers";

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
const AbstractContractWithConstructorCreate2Address =
  "0x10eDc0803800238782c483668EECe7053a116560";

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
    let config: UpgradeManagerContractConfig[] = [
      {
        id: "MockUpgradeableContract",
        contract: "MockUpgradeableContract",
        abstract: false,
        deterministic: false,
        constructorArgs: [],
      },
      {
        abstract: false,
        deterministic: false,
        id: "MockUpgradeableSecondInstance",
        contract: "MockUpgradeableContract",
        constructorArgs: [],
      },
      {
        contract: "MockUpgradeableContract",
        id: "ContractWithNoConfig",
        abstract: false,
        deterministic: false,
        constructorArgs: [],
      },
      {
        id: "AbstractContract",
        contract: "AbstractContract",
        abstract: true,
        deterministic: false,
        constructorArgs: [],
      },
      {
        id: "DeterministicContract",
        contract: "AbstractContract",
        abstract: true,
        deterministic: true,
        constructorArgs: [],
      },
      {
        abstract: true,
        contract: "AbstractContract",
        deterministic:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        id: "DeterministicContractDifferentSalt",
        constructorArgs: [],
      },
      {
        id: "AbstractContractWithConstructor",
        contract: "AbstractContractWithConstructor",
        abstract: true,
        deterministic: false,
        constructorArgs: [
          "0x0000000000000000000000000000000000000001",
          "AbstractContractWithConstructorBarString",
        ],
      },
      {
        id: "DeterministicContractWithConstructor",
        contract: "AbstractContractWithConstructor",
        abstract: true,
        deterministic: true,
        constructorArgs: [
          "0x0000000000000000000000000000000000000002",
          "DeterministicContractWithConstructorBarString",
        ],
      },
    ];
    expect(this.hre.config.upgradeManager.contracts).to.deep.equal(config);
  });

  it("Should deploy and upgrade contracts", async function () {
    await setupCreate2Proxy(this.hre);

    await expect(runTask(this.hre, "deploy:status")).to.be.rejectedWith(
      /Could not find upgrade manager address/
    );

    // Run the initial deployment
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

    let implAddress = await this.hre.upgrades.erc1967.getImplementationAddress(
      mockUpgradeableContract.address
    );

    let abstractContractAddress = "";
    let abstractContractWithConstructorAddress = "";

    for (
      let i = 0;
      i <
      (await upgradeManager.getProposedAbstractContractsLength()).toNumber();
      i++
    ) {
      let { id, contractAddress } =
        await upgradeManager.proposedAbstractContracts(i);
      switch (id) {
        case "AbstractContract":
          abstractContractAddress = contractAddress;
          break;
        case "AbstractContractWithConstructor":
          abstractContractWithConstructorAddress = contractAddress;
          break;
      }
    }

    let expectedStatus = [
      [
        "AbstractContract",
        "AbstractContract",
        null,
        "N/A (proposed)",
        abstractContractAddress,
        null,
        null,
      ],
      [
        "AbstractContractWithConstructor",
        "AbstractContractWithConstructor",
        null,
        "N/A (proposed)",
        abstractContractWithConstructorAddress,
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
        "N/A (proposed)",
        AbstractContractZeroSaltCreate2Address,
        null,
        null,
      ],
      [
        "DeterministicContractDifferentSalt",
        "AbstractContract",
        null,
        "N/A (proposed)",
        AbstractContractOneSaltCreate2Address,
        null,
        null,
      ],
      [
        "DeterministicContractWithConstructor",
        "AbstractContractWithConstructor",
        null,
        "N/A (proposed)",
        AbstractContractWithConstructorCreate2Address,
        null,
        null,
      ],
      [
        "MockUpgradeableContract",
        "MockUpgradeableContract",
        mockUpgradeableContract.address,
        implAddress,
        null,
        `setup(\n  string _fooString: "foo string value",\n  address _barAddress: "${mockUpgradeableSecondInstance.address}"\n)`,
        null,
      ],
      [
        "MockUpgradeableSecondInstance",
        "MockUpgradeableContract",
        mockUpgradeableSecondInstance.address,
        implAddress,
        null,
        `setup(\n  string _fooString: "foo string value second hardhat",\n  address _barAddress: "${mockUpgradeableContract.address}"\n)`,
        null,
      ],
    ];

    expect(await getStatusTable(this.hre)).to.deep.eq(expectedStatus);

    // Run the deploy again, check that it doesn't change the status
    ({ stdout } = await runTask(this.hre, "deploy"));

    expect(stdout).to.include(
      "Proposed  implementation of AbstractContract is already up to date"
    );
    expect(stdout).to.include(
      "Proposed  implementation of AbstractContract is already up to date"
    );
    expect(stdout).to.include(
      "Proposed  implementation of AbstractContract is already up to date"
    );
    expect(stdout).to.include(
      "Proposed  implementation of AbstractContractWithConstructor is already up to date"
    );
    expect(stdout).to.include(
      "Proposed  implementation of AbstractContractWithConstructor is already up to date"
    );
    expect(await getStatusTable(this.hre)).to.deep.eq(expectedStatus);

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

    let abstractContractWithConstructor = await this.hre.ethers.getContractAt(
      [
        "function fooAddr() public view returns (address)",
        "function barString() public view returns (string)",
      ],
      await upgradeManager.getAbstractContractAddress(
        "AbstractContractWithConstructor"
      )
    );

    expect(await abstractContractWithConstructor.fooAddr()).to.eq(
      "0x0000000000000000000000000000000000000001"
    );
    expect(await abstractContractWithConstructor.barString()).to.eq(
      "AbstractContractWithConstructorBarString"
    );
    let deterministicContractWithConstructor =
      await this.hre.ethers.getContractAt(
        [
          "function fooAddr() public view returns (address)",
          "function barString() public view returns (string)",
        ],
        await upgradeManager.getAbstractContractAddress(
          "DeterministicContractWithConstructor"
        )
      );

    expect(await deterministicContractWithConstructor.fooAddr()).to.eq(
      "0x0000000000000000000000000000000000000002"
    );
    expect(await deterministicContractWithConstructor.barString()).to.eq(
      "DeterministicContractWithConstructorBarString"
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
        "AbstractContractWithConstructor",
        "AbstractContractWithConstructor",
        null,
        abstractContractWithConstructor.address,
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
        "DeterministicContractWithConstructor",
        "AbstractContractWithConstructor",
        null,
        AbstractContractWithConstructorCreate2Address,
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
        "AbstractContractWithConstructor",
        "AbstractContractWithConstructor",
        null,
        abstractContractWithConstructor.address,
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
        "DeterministicContractWithConstructor",
        "AbstractContractWithConstructor",
        null,
        "0x10eDc0803800238782c483668EECe7053a116560",
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
  });

  it("Has a script to add a proposer", async function () {
    await setupCreate2Proxy(this.hre);

    // Run the initial deployment
    await runTask(this.hre, "deploy");
    let upgradeManager = await getFixtureProjectUpgradeManager(this);

    expect(await upgradeManager.getUpgradeProposers()).to.have.members([
      HardhatFirstAddress,
    ]);

    await runTask(this.hre, "deploy:add-proposer", {
      proposerAddress: HardhatSecondAddress,
    });

    expect(await upgradeManager.getUpgradeProposers()).to.have.members([
      HardhatFirstAddress,
      HardhatSecondAddress,
    ]);

    await expect(
      runTask(this.hre, "deploy:add-proposer", {
        proposerAddress: HardhatSecondAddress,
      })
    ).to.be.rejectedWith(`${HardhatSecondAddress} is already a proposer`);

    await runTask(this.hre, "deploy:remove-proposer", {
      proposerAddress: HardhatSecondAddress,
    });

    expect(await upgradeManager.getUpgradeProposers()).to.have.members([
      HardhatFirstAddress,
    ]);

    await expect(
      runTask(this.hre, "deploy:remove-proposer", {
        proposerAddress: HardhatSecondAddress,
      })
    ).to.be.rejectedWith(`${HardhatSecondAddress} is not a proposer`);
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

      let contractAddress = await deployCreate2Contract({
        signer: this.hre.ethers.provider.getSigner(),
        bytecode: factory.bytecode,
      });

      expect(getAddress(contractAddress)).to.eq(
        AbstractContractZeroSaltCreate2Address
      );

      expect(await factory.attach(contractAddress).version()).to.eq("1");
      let contractAddress2 = await deployCreate2Contract({
        signer: this.hre.ethers.provider.getSigner(),
        bytecode: factory.bytecode,
        salt: "0x0000000000000000000000000000000000000000000000000000000000000001",
      });

      expect(getAddress(contractAddress2)).to.eq(
        AbstractContractOneSaltCreate2Address
      );

      let constructorArgsFactory = await this.hre.ethers.getContractFactory(
        "AbstractContractWithConstructor"
      );

      let expectedAddress = getCreate2Address({
        bytecode: constructorArgsFactory.bytecode,
        constructorArgs: [
          ["address", "string"],
          [
            "0x0000000000000000000000000000000000000002",
            "DeterministicContractWithConstructorBarString",
          ],
        ],
        salt: "0x0000000000000000000000000000000000000000000000000000000000000001",
      });

      let contractAddress3 = await deployCreate2Contract({
        signer: this.hre.ethers.provider.getSigner(),
        bytecode: constructorArgsFactory.bytecode,
        constructorArgs: [
          ["address", "string"],
          [
            "0x0000000000000000000000000000000000000002",
            "DeterministicContractWithConstructorBarString",
          ],
        ],
        salt: "0x0000000000000000000000000000000000000000000000000000000000000001",
      });

      expect(contractAddress3).to.eq(expectedAddress);

      // Check it is idempotent and doesn't error on attempted redeploy
      contractAddress3 = await deployCreate2Contract({
        signer: this.hre.ethers.provider.getSigner(),
        bytecode: constructorArgsFactory.bytecode,
        constructorArgs: [
          ["address", "string"],
          [
            "0x0000000000000000000000000000000000000002",
            "DeterministicContractWithConstructorBarString",
          ],
        ],
        salt: "0x0000000000000000000000000000000000000000000000000000000000000001",
      });
      expect(contractAddress3).to.eq(expectedAddress);
    });
  });

  describe.only("deploy:safe-ownership", () => {
    it("should transfer the ownership of the upgrade manager to the newly created safe", async function () {
      await setupCreate2Proxy(this.hre);
      await deployGnosisSafeProxyFactoryAndSingleton(this.hre);

      // Run the initial deployment
      await runTask(this.hre, "deploy");

      // Call the deploy:safe-setup task
      await runTask(this.hre, "deploy:safe-setup", {
        newSafeOwners: [HardhatFirstAddress].join(","),
        newSafeThreshold: 1,
        autoConfirm: true,
      });

      const upgradeManager = await getFixtureProjectUpgradeManager(this);

      // Get the address of the newly created safe from the task's result
      const safeAddress = await upgradeManager.owner();

      // Get the Gnosis Safe contract using its address
      const safe = await getIncludedContractAt(
        this.hre,
        "GnosisSafe",
        safeAddress
      );

      // Assert that the Gnosis Safe contract has the expected signers and threshold
      expect(await safe.getOwners()).to.have.members([HardhatFirstAddress]);
      expect(await safe.getThreshold()).equal("1");

      // Add a proposer and test that the address is added to upgrade proposers

      await runTask(this.hre, "deploy:add-proposer", {
        proposerAddress: HardhatSecondAddress,
        autoConfirm: true,
      });

      expect(await upgradeManager.getUpgradeProposers()).to.have.members([
        HardhatFirstAddress,
        HardhatSecondAddress,
      ]);

      // Add safe owner and set the threshold to 2. verify the owner is added and the threshold changes
      await runTask(this.hre, "deploy:add-safe-owner", {
        newSafeOwnerAddress: HardhatSecondAddress,
        newSafeThreshold: 2,
        autoConfirm: true,
      });

      expect(await safe.getOwners()).to.have.members([
        HardhatFirstAddress,
        HardhatSecondAddress,
      ]);
      expect(await safe.getThreshold()).equal("2");

      // Modify a contract locally and propose upgrade

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

      await runTask(this.hre, "deploy");

      // Run the deploy:upgrade script once and get signature data for first safe owner

      let { result: signatures } = await runTask(this.hre, "deploy:upgrade", {
        newVersion: "2.0",
        autoConfirm: true,
      });

      // Run the deploy:upgrade script again, passing in the first signature
      await runTask(this.hre, "deploy:upgrade", {
        newVersion: "2.0",
        priorSignatures: encodePriorSignatures(signatures as SafeSignature[]),
        autoConfirm: true,
        impersonateAddress: HardhatSecondAddress,
      });

      // Verify contracts upgraded
      expect(await upgradeManager.version()).to.eq("2.0");

      // Remove a proposer and test that the address is removed from upgrade proposers
      ({ result: signatures } = await runTask(
        this.hre,
        "deploy:remove-proposer",
        {
          proposerAddress: HardhatFirstAddress,
          autoConfirm: true,
        }
      ));
      await runTask(this.hre, "deploy:remove-proposer", {
        proposerAddress: HardhatFirstAddress,
        autoConfirm: true,
        impersonateAddress: HardhatSecondAddress,
        priorSignatures: encodePriorSignatures(signatures as SafeSignature[]),
      });

      expect(await upgradeManager.getUpgradeProposers()).to.have.members([
        HardhatSecondAddress,
      ]);

      // set safe threshold to 1
      ({ result: signatures } = await runTask(
        this.hre,
        "deploy:set-safe-threshold",
        {
          newSafeThreshold: 1,
          autoConfirm: true,
        }
      ));
      await runTask(this.hre, "deploy:set-safe-threshold", {
        newSafeThreshold: 1,
        autoConfirm: true,
        priorSignatures: encodePriorSignatures(signatures as SafeSignature[]),
        impersonateAddress: HardhatSecondAddress,
      });

      expect(await safe.getThreshold()).to.eq(1);

      // remove safe owner

      await runTask(this.hre, "deploy:remove-safe-owner", {
        removeSafeOwnerAddress: HardhatSecondAddress,
        autoConfirm: true,
      });

      expect(await safe.getOwners()).to.have.members([HardhatFirstAddress]);
      expect(await safe.getThreshold()).to.eq(1);
    });
  });

  it("tests call");
  it("Audit TODOs");
  it("Audit dryRun");
  it("handles verification");
  it("reverts with custom errors not strings");
  it("has ability to get upgrade manager contract from hre");
});

function getIncludedContractAt(
  hre: HardhatRuntimeEnvironment,
  contractName: "GnosisSafe",
  contractAddress: string
): Promise<GnosisSafe>;

async function getIncludedContractAt(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  contractAddress: string
): Promise<Contract> {
  let { abi } = readArtifactFromPlugin(contractName);
  return await hre.ethers.getContractAt(abi, contractAddress);
}

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
