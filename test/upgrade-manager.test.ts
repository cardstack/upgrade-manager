import { AddressZero } from "@ethersproject/constants";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Contract } from "ethers";
import { solidityKeccak256 } from "ethers/lib/utils";
import { existsSync, unlinkSync } from "fs";
import { ethers, upgrades } from "hardhat";
import { join } from "path";
import {
  AbstractContractV1,
  AbstractContractV1__factory,
  AbstractContractV2__factory,
  UpgradeableContractV1__factory,
  UpgradeableContractV2__factory,
  UpgradeManager,
  UpgradeManager__factory,
} from "../typechain-types";

const manifestPath = join(__dirname, "../.openzeppelin/unknown-31337.json");

const {
  deployProxy,
  prepareUpgrade,

  erc1967: { getAdminAddress, getImplementationAddress },
} = upgrades;

describe("UpgradeManager", () => {
  let accounts,
    owner: string,
    proposer: string,
    newProposer: string,
    randomEOA: string,
    otherOwner: string,
    upgradeManager: UpgradeManager,
    upgradeManagerAsProposer: UpgradeManager,
    UpgradeManager: UpgradeManager__factory,
    UpgradeableContractV1: UpgradeableContractV1__factory,
    UpgradeableContractV2: UpgradeableContractV2__factory,
    AbstractContractV1: AbstractContractV1__factory,
    AbstractContractV2: AbstractContractV2__factory;

  async function setupFixture() {
    accounts = await ethers.getSigners();
    [owner, proposer, newProposer, randomEOA, otherOwner] = await Promise.all(
      accounts.map((a) => a.getAddress())
    );

    UpgradeManager = await ethers.getContractFactory("UpgradeManager");

    UpgradeableContractV1 = await ethers.getContractFactory(
      "UpgradeableContractV1"
    );

    UpgradeableContractV2 = await ethers.getContractFactory(
      "UpgradeableContractV2"
    );

    AbstractContractV1 = await ethers.getContractFactory(
      "UpgradeableContractV1"
    );

    AbstractContractV2 = await ethers.getContractFactory(
      "UpgradeableContractV2"
    );

    let upgradeManager = await UpgradeManager.deploy();
    await upgradeManager.initialize(owner);
    await upgradeManager.setup([proposer]);

    let upgradeManagerAsProposer = await contractWithSigner(
      upgradeManager,
      proposer
    );

    return {
      owner,
      proposer,
      newProposer,
      randomEOA,
      otherOwner,
      UpgradeManager,
      upgradeManager,
      upgradeManagerAsProposer,
      UpgradeableContractV1,
      UpgradeableContractV2,
    };
  }

  beforeEach(async () => {
    clearManifest();
    ({
      owner,
      proposer,
      newProposer,
      randomEOA,
      otherOwner,
      upgradeManager,
      upgradeManagerAsProposer,
      UpgradeManager,
      UpgradeableContractV1,
      UpgradeableContractV2,
    } = await loadFixture(setupFixture));
  });

  async function deployV1({
    from = owner,
    contract = "UpgradeableContractV1",
  } = {}): Promise<{
    proxyAdmin: Contract;
    instance: Contract;
  }> {
    let signer = await ethers.getSigner(from);

    let UpgradeableContractV1 = await ethers.getContractFactory(
      contract,
      signer
    );

    let instance = await deployProxy(UpgradeableContractV1, [owner]);
    let proxyAdminAddress = await getAdminAddress(instance.address);

    let proxyAdmin = await ethers.getContractAt(
      "IProxyAdmin",
      proxyAdminAddress
    );

    expect(await proxyAdmin.getProxyAdmin(instance.address)).to.equal(
      proxyAdmin.address
    );

    return { proxyAdmin, instance };
  }

  async function transferProxyAdminOwnership(
    proxyAdmin: Contract,
    newOwner: string
  ) {
    let adminOwner = await proxyAdmin.owner();
    if (adminOwner !== newOwner) {
      await proxyAdmin.transferOwnership(newOwner);
    }
  }

  async function asAdminUpgradeabilityProxy(contract: Contract) {
    return ethers.getContractAt("IAdminUpgradeabilityProxy", contract.address);
  }

  async function deployAndAdoptContract({
    id = "UpgradeableContract",
    contract = "UpgradeableContractV1",
  } = {}): Promise<{
    proxyAdmin: Contract;
    instance: Contract;
  }> {
    let { instance, proxyAdmin } = await deployV1({ contract });
    await transferProxyAdminOwnership(proxyAdmin, upgradeManager.address);
    await instance.transferOwnership(upgradeManager.address);

    await upgradeManager.adoptContract(
      id,
      instance.address,
      proxyAdmin.address
    );

    return { instance, proxyAdmin };
  }

  function clearManifest() {
    if (existsSync(manifestPath)) {
      unlinkSync(manifestPath);
    }
  }

  function encodeWithSignature(signature: string, ...args: unknown[]) {
    let iface = new ethers.utils.Interface([`function ${signature}`]);
    return iface.encodeFunctionData(signature, args);
  }

  async function contractWithSigner<C extends Contract>(
    contract: C,
    signer: string
  ): Promise<C> {
    return contract.connect(await ethers.getSigner(signer)) as C;
  }

  it("can get version of contract", async () => {
    expect(await upgradeManager.version()).to.equal("");
    await upgradeManager.upgrade("1.0.0", "0");
    expect(await upgradeManager.version()).to.equal("1.0.0");
  });

  it("reports the contract version", async () => {
    expect(await upgradeManager.CONTRACT_VERSION()).to.equal(1);
  });

  it("has a set of upgrade proposers", async () => {
    expect(await upgradeManager.getUpgradeProposers()).to.have.members([
      proposer,
    ]);

    await expect(await upgradeManager.setup([proposer, newProposer]))
      .to.emit(upgradeManager, "Setup")
      .and.to.emit(upgradeManager, "ProposerAdded")
      .withArgs(newProposer);

    expect(await upgradeManager.getUpgradeProposers()).to.have.members([
      proposer,
      newProposer,
    ]);

    await expect(await upgradeManager.removeUpgradeProposer(proposer))
      .to.emit(upgradeManager, "ProposerRemoved")
      .withArgs(proposer);

    expect(await upgradeManager.getUpgradeProposers()).to.have.members([
      newProposer,
    ]);

    await expect(await upgradeManager.addUpgradeProposer(randomEOA)).to.emit(
      upgradeManager,
      "ProposerAdded"
    );

    expect(await upgradeManager.getUpgradeProposers()).to.have.members([
      randomEOA,
      newProposer,
    ]);
  });

  it("Can adopt a contract if it is the owner of the proxy admin and the proxy", async () => {
    let { instance, proxyAdmin } = await deployV1();
    await transferProxyAdminOwnership(proxyAdmin, upgradeManager.address);
    await instance.transferOwnership(upgradeManager.address);

    await expect(
      upgradeManager.adoptContract(
        "UpgradeableContractV1",
        instance.address,
        proxyAdmin.address
      )
    )
      .to.emit(upgradeManager, "ContractAdopted")
      .withArgs("UpgradeableContractV1", instance.address);

    expect(await upgradeManager.getProxies()).to.have.members([
      instance.address,
    ]);
    expect(
      await upgradeManager.adoptedContractAddresses("UpgradeableContractV1")
    ).to.eq(instance.address);
    expect(await upgradeManager.getAdoptedContractId(instance.address)).to.eq(
      "UpgradeableContractV1"
    );
  });

  it("fails to adopt if it's not a proxy", async () => {
    let { proxyAdmin } = await deployV1();
    await transferProxyAdminOwnership(proxyAdmin, upgradeManager.address);

    let instance = await UpgradeableContractV1.deploy();
    await instance.initialize(upgradeManager.address);

    await expect(
      upgradeManager.adoptContract(
        "UpgradeableContract",
        instance.address,
        proxyAdmin.address
      )
    ).to.be.rejectedWith(
      "Call to determine proxy admin ownership of proxy failed"
    );
  });

  it("fails to adopt the contract if it is not the owner of the proxy admin", async () => {
    let { instance, proxyAdmin } = await deployV1({ from: otherOwner });

    await expect(
      upgradeManager.adoptContract(
        "UpgradeableContractV1",
        instance.address,
        proxyAdmin.address
      )
    ).to.be.rejectedWith("Must be owner of ProxyAdmin to adopt");
  });

  it("fails to adopt the contract if it is not the owner of the contract", async () => {
    let { instance, proxyAdmin } = await deployV1();
    await transferProxyAdminOwnership(proxyAdmin, upgradeManager.address);

    await expect(
      upgradeManager.adoptContract(
        "UpgradeableContractV1",
        instance.address,
        proxyAdmin.address
      )
    ).to.be.rejectedWith("Must be owner of contract to adopt");
  });

  it("fails to adopt if the proxy admin is not the right proxy admin for the contract being adopted", async () => {
    let { instance: instance1, proxyAdmin: proxyAdmin1 } = await deployV1({
      from: owner,
    });

    clearManifest();

    let { proxyAdmin: proxyAdmin2 } = await deployV1({
      from: otherOwner,
    });

    expect(proxyAdmin1.address).not.to.eq(
      proxyAdmin2.address,
      "For this test there should be two different proxy admins"
    );

    await expect(
      upgradeManager.adoptContract(
        "UpgradeableContractV1",
        instance1.address,
        proxyAdmin2.address
      )
    ).to.be.rejectedWith("Must be owner of ProxyAdmin to adopt");
  });

  it("validates the contract id", async () => {
    await deployAndAdoptContract({
      id: "Collision",
    });
    await expect(
      deployAndAdoptContract({
        id: "Collision",
      })
    ).to.be.rejectedWith("Contract id already registered");
    await expect(
      deployAndAdoptContract({
        id: "",
      })
    ).to.be.rejectedWith("Contract id must not be empty");
  });

  it("allows a proposer to propose an upgrade", async () => {
    let { instance } = await deployAndAdoptContract();

    let newImplementationAddress = (await prepareUpgrade(
      instance.address,
      UpgradeableContractV2
    )) as string;

    await expect(
      (
        await contractWithSigner(upgradeManager, randomEOA)
      ).proposeUpgrade("UpgradeableContract", newImplementationAddress, {
        from: randomEOA,
      })
    ).to.be.rejectedWith("Caller is not proposer");

    upgradeManager = await contractWithSigner(upgradeManager, proposer);

    await expect(
      upgradeManager.proposeUpgrade(
        "UpgradeableContract",
        newImplementationAddress
      )
    )
      .to.emit(upgradeManager, "ChangesProposed")
      .withArgs("UpgradeableContract", newImplementationAddress, "0x");

    expect(await upgradeManager.getProxiesWithPendingChanges()).to.eql([
      instance.address,
    ]);

    expect(
      await upgradeManager.getPendingUpgradeAddress(instance.address)
    ).to.eq(newImplementationAddress);
  });
  it("upgrades a contract", async () => {
    let { instance } = await deployAndAdoptContract();
    await upgradeManager.upgrade("1.0.0", await upgradeManager.nonce());

    expect(await instance.version()).to.eq("1");
    expect(await upgradeManager.version()).to.eq("1.0.0");

    let newImplementationAddress = (await prepareUpgrade(
      instance.address,
      UpgradeableContractV2
    )) as string;

    await upgradeManagerAsProposer.proposeUpgrade(
      "UpgradeableContract",
      newImplementationAddress
    );

    expect(await instance.version()).to.eq("1");
    expect(await upgradeManager.version()).to.eq("1.0.0");

    await expect(upgradeManager.upgrade("1.0.1", await upgradeManager.nonce()))
      .to.emit(upgradeManager, "Upgraded")
      .withArgs("1.0.1");

    expect(await instance.version()).to.eq("2");
    expect(await upgradeManager.version()).to.eq("1.0.1");
  });

  it("upgrades multiple contracts atomically", async () => {
    let { instance: instance1, proxyAdmin: proxyAdmin1 } =
      await deployAndAdoptContract({
        id: "ContractA",
      });
    let { instance: instance2, proxyAdmin: proxyAdmin2 } =
      await deployAndAdoptContract({
        id: "ContractB",
      });

    expect(await instance1.version()).to.eq("1");
    expect(await instance2.version()).to.eq("1");
    expect(proxyAdmin1.address).to.eq(proxyAdmin2.address);

    let newImplementationAddress1 = (await prepareUpgrade(
      instance1.address,
      UpgradeableContractV2
    )) as string;
    let newImplementationAddress2 = await prepareUpgrade(
      instance2.address,
      UpgradeableContractV2
    );

    expect(newImplementationAddress1).to.eq(newImplementationAddress2);

    await upgradeManagerAsProposer.proposeUpgrade(
      "ContractA",
      newImplementationAddress1
    );
    await upgradeManagerAsProposer.proposeUpgrade(
      "ContractB",
      newImplementationAddress1
    );

    expect(await instance1.version()).to.eq("1");
    expect(await instance2.version()).to.eq("1");

    expect(await upgradeManager.getProxiesWithPendingChanges()).to.eql([
      instance1.address,
      instance2.address,
    ]);

    await expect(upgradeManager.upgrade("1.0.1", "2"))
      .to.emit(await asAdminUpgradeabilityProxy(instance1), "Upgraded")
      .withArgs(newImplementationAddress1)
      .and.to.emit(await asAdminUpgradeabilityProxy(instance2), "Upgraded")
      .withArgs(newImplementationAddress1);

    expect(await instance1.version()).to.eq("2");
    expect(await instance2.version()).to.eq("2");
  });

  it("only allows owner to upgrade", async () => {
    let { instance } = await deployAndAdoptContract();

    expect(await instance.version()).to.eq("1");

    let newImplementationAddress = (await prepareUpgrade(
      instance.address,
      UpgradeableContractV2
    )) as string;

    await upgradeManagerAsProposer.proposeUpgrade(
      "UpgradeableContract",
      newImplementationAddress
    );

    expect(await instance.version()).to.eq("1");

    upgradeManager = await contractWithSigner(upgradeManager, randomEOA);

    await expect(
      upgradeManager.upgrade("1.0.1", "1", { from: randomEOA })
    ).to.be.rejectedWith("Ownable: caller is not the owner");

    expect(await instance.version()).to.eq("1");
  });

  it("only allows proposal to registered contract", async () => {
    let { instance } = await deployAndAdoptContract();

    let newImplementationAddress = (await prepareUpgrade(
      instance.address,
      UpgradeableContractV2
    )) as string;

    let encodedCall = encodeWithSignature("foo(string)", "bar");
    await expect(
      upgradeManagerAsProposer.proposeUpgrade(
        "BadName",
        newImplementationAddress
      )
    ).to.be.rejectedWith("Unknown contract id");
    await expect(
      upgradeManagerAsProposer.proposeCall("BadName", encodedCall)
    ).to.be.rejectedWith("Unknown contract id");
    await expect(
      upgradeManagerAsProposer.proposeUpgradeAndCall(
        "BadName",
        newImplementationAddress,
        encodedCall
      )
    ).to.be.rejectedWith("Unknown contract id");
  });
  it("only allows owner to call", async () => {
    let { instance } = await deployAndAdoptContract({
      contract: "UpgradeableContractV2",
    });

    expect(await instance.foo()).to.eq("");

    await expect(
      (
        await contractWithSigner(upgradeManager, proposer)
      ).call(
        "UpgradeableContract",
        encodeWithSignature("setup(string)", "bar"),
        { from: proposer }
      )
    ).to.be.rejectedWith("Ownable: caller is not the owner");
    await expect(
      (
        await contractWithSigner(upgradeManager, randomEOA)
      ).call(
        "UpgradeableContract",
        encodeWithSignature("setup(string)", "bar"),
        { from: randomEOA }
      )
    ).to.be.rejectedWith("Ownable: caller is not the owner");

    expect(await instance.foo()).to.eq("");
  });

  it("allows retracting change proposals", async () => {
    let { instance: instance1 } = await deployAndAdoptContract({ id: "C1" });
    let { instance: instance2 } = await deployAndAdoptContract({ id: "C2" });
    let { instance: instance3 } = await deployAndAdoptContract({
      id: "C3",
      contract: "UpgradeableContractV2",
    });

    await upgradeManagerAsProposer.proposeUpgrade(
      "C1",
      (await prepareUpgrade(instance1.address, UpgradeableContractV2)) as string
    );

    await upgradeManagerAsProposer.proposeUpgradeAndCall(
      "C2",
      (await prepareUpgrade(
        instance2.address,
        UpgradeableContractV2
      )) as string,
      encodeWithSignature("setup(string)", "bar")
    );

    await upgradeManagerAsProposer.proposeCall(
      "C3",
      encodeWithSignature("setup(string)", "baz")
    );

    // only proposers can withdraw changes
    await expect(upgradeManager.withdrawChanges("C1")).to.be.rejectedWith(
      "Caller is not proposer"
    );

    expect(await upgradeManager.nonce()).to.eq(3);
    await expect(
      upgradeManagerAsProposer.withdrawChanges("C1", { from: proposer })
    )
      .to.emit(upgradeManager, "ChangesWithdrawn")
      .withArgs("C1");
    expect(await upgradeManager.nonce()).to.eq(4);
    await expect(
      upgradeManagerAsProposer.withdrawChanges("C2", { from: proposer })
    )
      .to.emit(upgradeManager, "ChangesWithdrawn")
      .withArgs("C2");

    expect(await upgradeManager.nonce()).to.eq(5);
    await expect(
      upgradeManagerAsProposer.withdrawChanges("C3", { from: proposer })
    )
      .to.emit(upgradeManager, "ChangesWithdrawn")
      .withArgs("C3");

    expect(await upgradeManager.nonce()).to.eq(6);

    expect(await upgradeManager.getPendingCallData(instance1.address)).to.eq(
      "0x"
    );
    expect(await upgradeManager.getPendingCallData(instance2.address)).to.eq(
      "0x"
    );
    expect(await upgradeManager.getPendingCallData(instance3.address)).to.eq(
      "0x"
    );
    expect(
      await upgradeManager.getPendingUpgradeAddress(instance1.address)
    ).to.eq(AddressZero);
    expect(
      await upgradeManager.getPendingUpgradeAddress(instance2.address)
    ).to.eq(AddressZero);
    expect(
      await upgradeManager.getPendingUpgradeAddress(instance3.address)
    ).to.eq(AddressZero);
    expect(await upgradeManager.getProxiesWithPendingChanges()).to.eql([]);
  });
  it("allows an empty upgrade (so the protocol version can be force-set)", async () => {
    await deployAndAdoptContract();
    await upgradeManager.upgrade("1.0.1", "0");
    expect(await upgradeManager.version()).to.eq("1.0.1");
  });
  it("requires a version number to be present to upgrade", async () => {
    await deployAndAdoptContract();
    await expect(upgradeManager.upgrade("", "0")).to.be.rejectedWith(
      "New version must be set"
    );
  });
  it("allows calling arbitrary functions as owner", async () => {
    let { instance } = await deployAndAdoptContract({
      contract: "UpgradeableContractV2",
    });

    expect(await instance.foo()).to.eq("");
    let encodedCallData = encodeWithSignature("setup(string)", "bar");
    await upgradeManager.call("UpgradeableContract", encodedCallData);
    expect(await instance.foo()).to.eq("bar");
  });

  it("allows upgradeAndCall", async () => {
    let { instance } = await deployAndAdoptContract();

    let instanceV2 = UpgradeableContractV2.attach(instance.address);

    expect(await instance.version()).to.eq("1");
    await expect(instanceV2.foo()).to.be.rejected;
    let newImplementationAddress = (await prepareUpgrade(
      instance.address,
      UpgradeableContractV2
    )) as string;

    let encodedCallData = encodeWithSignature("setup(string)", "bar");
    await upgradeManagerAsProposer.proposeUpgradeAndCall(
      "UpgradeableContract",
      newImplementationAddress,
      encodedCallData
    );

    expect(await upgradeManager.getPendingCallData(instance.address)).to.eq(
      encodedCallData
    );
    await expect(instanceV2.foo()).to.be.rejected;
    await upgradeManager.upgrade("1.0.1", "1");
    expect(await instanceV2.version()).to.eq("2");
    expect(await instanceV2.foo()).to.eq("bar");
    expect(await upgradeManager.getPendingCallData(instance.address)).to.eq(
      "0x"
    );
  });

  it("Allows a combination of upgrade, call, and upgradeAndCall in the same batched operation", async () => {
    let { instance: instance1 } = await deployAndAdoptContract({ id: "C1" });
    let { instance: instance2 } = await deployAndAdoptContract({ id: "C2" });
    let { instance: instance3 } = await deployAndAdoptContract({
      id: "C3",
      contract: "UpgradeableContractV2",
    });

    expect(await upgradeManager.nonce()).to.eq(0);
    await upgradeManagerAsProposer.proposeUpgrade(
      "C1",
      (await prepareUpgrade(instance1.address, UpgradeableContractV2)) as string
    );
    expect(await upgradeManager.nonce()).to.eq(1);

    await upgradeManagerAsProposer.proposeUpgradeAndCall(
      "C2",
      (await prepareUpgrade(
        instance2.address,
        UpgradeableContractV2
      )) as string,
      encodeWithSignature("setup(string)", "bar")
    );
    expect(await upgradeManager.nonce()).to.eq(2);

    await upgradeManagerAsProposer.proposeCall(
      "C3",
      encodeWithSignature("setup(string)", "baz")
    );
    expect(await upgradeManager.nonce()).to.eq(3);

    let instance1AsV2 = await ethers.getContractAt(
      "UpgradeableContractV2",
      instance1.address
    );
    let instance2AsV2 = await ethers.getContractAt(
      "UpgradeableContractV2",
      instance2.address
    );

    expect(await instance1.version()).to.eq("1");
    await expect(instance1AsV2.foo()).to.be.rejectedWith(
      "call revert exception"
    );

    expect(await instance2.version()).to.eq("1");
    await expect(instance2AsV2.foo()).to.be.rejectedWith(
      "call revert exception"
    );

    expect(await instance3.version()).to.eq("2");
    expect(await instance3.foo()).to.eq("");

    expect(await upgradeManager.getProxiesWithPendingChanges()).to.eql([
      instance1.address,
      instance2.address,
      instance3.address,
    ]);

    await expect(upgradeManager.upgrade("1.0.2", "2")).to.be.rejectedWith(
      "Invalid nonce"
    );
    await upgradeManager.upgrade("1.0.1", "3");

    expect(await upgradeManager.nonce()).to.eq(
      4,
      "a protocol upgrade should increment the nonce by exactly 1"
    );

    expect(await instance1.version()).to.eq("2");
    expect(await instance1AsV2.foo()).to.eq("");

    expect(await instance2.version()).to.eq("2");
    expect(await instance2AsV2.foo()).to.eq("bar");

    expect(await instance3.version()).to.eq("2");
    expect(await instance3.foo()).to.eq("baz");

    expect(await upgradeManager.getPendingCallData(instance1.address)).to.eq(
      "0x"
    );
    expect(await upgradeManager.getPendingCallData(instance2.address)).to.eq(
      "0x"
    );
    expect(await upgradeManager.getPendingCallData(instance3.address)).to.eq(
      "0x"
    );
    expect(
      await upgradeManager.getPendingUpgradeAddress(instance1.address)
    ).to.eq(AddressZero);
    expect(
      await upgradeManager.getPendingUpgradeAddress(instance2.address)
    ).to.eq(AddressZero);
    expect(
      await upgradeManager.getPendingUpgradeAddress(instance3.address)
    ).to.eq(AddressZero);
    expect(await upgradeManager.getProxiesWithPendingChanges()).to.eql([]);
  });

  it("handles proposing when already proposed", async () => {
    let { instance: instance1 } = await deployAndAdoptContract({ id: "C1" });
    let { instance: instance2 } = await deployAndAdoptContract({ id: "C2" });
    await deployAndAdoptContract({
      id: "C3",
      contract: "UpgradeableContractV2",
    });

    upgradeManager = await contractWithSigner(upgradeManager, proposer);

    await upgradeManager.proposeUpgrade(
      "C1",
      (await prepareUpgrade(instance1.address, UpgradeableContractV2)) as string
    );

    await upgradeManager.proposeUpgradeAndCall(
      "C2",
      (await prepareUpgrade(
        instance2.address,
        UpgradeableContractV2
      )) as string,
      encodeWithSignature("setup(string)", "bar")
    );

    await upgradeManager.proposeCall(
      "C3",
      encodeWithSignature("setup(string)", "baz")
    );
    await expect(
      upgradeManager.proposeUpgrade(
        "C1",
        (await prepareUpgrade(
          instance1.address,
          UpgradeableContractV2
        )) as string
      )
    ).to.be.rejectedWith("Upgrade already proposed, withdraw first");
    await expect(
      upgradeManager.proposeUpgradeAndCall(
        "C2",
        (await prepareUpgrade(
          instance2.address,
          UpgradeableContractV2
        )) as string,
        encodeWithSignature("setup(string)", "bar")
      )
    ).to.be.rejectedWith("Upgrade already proposed, withdraw first");
    await expect(
      upgradeManager.proposeCall(
        "C3",
        encodeWithSignature("setup(string)", "baz")
      )
    ).to.be.rejectedWith("Upgrade already proposed, withdraw first");
  });

  it("has safety rails around Ownable module to prevent footguns", async () => {
    await expect(
      upgradeManager.transferOwnership(AddressZero)
    ).to.be.rejectedWith("Ownable: new owner is the zero address");
    await expect(
      upgradeManager.transferOwnership(upgradeManager.address)
    ).to.be.rejectedWith("Ownable: new owner is this contract");
    await expect(upgradeManager.renounceOwnership()).to.be.rejectedWith(
      "Ownable: cannot renounce ownership"
    );

    await expect(upgradeManager.transferOwnership(otherOwner))
      .to.emit(upgradeManager, "OwnershipTransferred")
      .withArgs(owner, otherOwner);

    expect(await upgradeManager.owner()).to.eq(otherOwner);
  });

  it("allows transferring ownership of proxy and proxyAdmin away", async () => {
    let { instance, proxyAdmin } = await deployAndAdoptContract({
      id: "OwnedContract",
    });
    let newImplementationAddress = (await prepareUpgrade(
      instance.address,
      UpgradeableContractV2
    )) as string;
    clearManifest();

    let { proxyAdmin: proxyAdmin2 } = await deployV1({
      from: otherOwner,
    });

    let encodedCall = encodeWithSignature("foo(string)", "bar");

    await upgradeManagerAsProposer.proposeUpgradeAndCall(
      "OwnedContract",
      newImplementationAddress,
      encodedCall
    );

    let managerAsRandom = await contractWithSigner(upgradeManager, randomEOA);

    await expect(
      managerAsRandom.disown("OwnedContract", otherOwner)
    ).to.be.rejectedWith("Ownable: caller is not the owner");

    // Check state before
    expect(await upgradeManager.nonce()).to.eq(1);
    expect(await upgradeManager.getProxies()).to.eql([instance.address]);
    expect(await upgradeManager.getProxiesWithPendingChanges()).to.eql([
      instance.address,
    ]);

    let adoptedContract = await upgradeManager.adoptedContractsByProxyAddress(
      instance.address
    );

    expect(adoptedContract.id).to.eq("OwnedContract");
    expect(adoptedContract.proxyAdmin).to.eq(proxyAdmin.address);
    expect(adoptedContract.encodedCall).to.eq(encodedCall);
    expect(adoptedContract.upgradeAddress).to.eq(newImplementationAddress);

    expect(
      await upgradeManager.adoptedContractAddresses("OwnedContract")
    ).to.eq(instance.address);
    expect(await upgradeManager.getAdoptedContractId(instance.address)).to.eq(
      "OwnedContract"
    );
    expect(
      await upgradeManager.getPendingUpgradeAddress(instance.address)
    ).to.eq(newImplementationAddress);
    expect(await upgradeManager.getPendingCallData(instance.address)).to.eq(
      encodedCall
    );

    await expect(
      upgradeManager.changeProxyAdmin(
        proxyAdmin.address,
        instance.address,
        proxyAdmin2.address
      )
    ).to.be.rejectedWith("Cannot change proxy admin for owned contract");

    // Disown the contract
    await expect(upgradeManager.disown("OwnedContract", otherOwner))
      .to.emit(upgradeManager, "ContractDisowned")
      .withArgs("OwnedContract", instance.address)
      .and.to.emit(instance, "OwnershipTransferred")
      .withArgs(upgradeManager.address, otherOwner);

    // Check state after
    expect(await upgradeManager.nonce()).to.eq(2);
    expect(await upgradeManager.getProxies()).to.eql([]);
    expect(await upgradeManager.getProxiesWithPendingChanges()).to.eql([]);

    adoptedContract = await upgradeManager.adoptedContractsByProxyAddress(
      instance.address
    );

    expect(adoptedContract.id).to.eq("");
    expect(adoptedContract.proxyAdmin).to.eq(AddressZero);
    expect(adoptedContract.encodedCall).to.eq("0x");
    expect(adoptedContract.upgradeAddress).to.eq(AddressZero);

    expect(
      await upgradeManager.adoptedContractAddresses("OwnedContract")
    ).to.eq(AddressZero);

    expect(await upgradeManager.getAdoptedContractId(instance.address)).to.eq(
      ""
    );
    expect(
      await upgradeManager.getPendingUpgradeAddress(instance.address)
    ).to.eq(AddressZero);
    expect(await upgradeManager.getPendingCallData(instance.address)).to.eq(
      "0x"
    );

    expect(await instance.owner()).to.eq(
      otherOwner,
      "The proxy owner is changed to the new owner"
    );
    expect(await proxyAdmin.getProxyAdmin(instance.address)).to.eq(
      proxyAdmin.address,
      "The proxyAdmin is not changed"
    );
    expect(await proxyAdmin.owner()).to.eq(
      upgradeManager.address,
      "The proxyAdmin owner is not changed (because it's usually shared between multiple proxies)"
    );

    expect(proxyAdmin2.address).not.to.eq(proxyAdmin.address);

    await expect(
      managerAsRandom.changeProxyAdmin(
        proxyAdmin.address,
        instance.address,
        proxyAdmin2.address
      )
    ).to.be.rejectedWith("Ownable: caller is not the owner");

    await upgradeManager.changeProxyAdmin(
      proxyAdmin.address,
      instance.address,
      proxyAdmin2.address
    );

    expect(await proxyAdmin2.getProxyAdmin(instance.address)).to.eq(
      proxyAdmin2.address,
      "The proxyAdmin is now updated"
    );

    await expect(
      managerAsRandom.disownProxyAdmin(proxyAdmin.address, otherOwner)
    ).to.be.rejectedWith("Ownable: caller is not the owner");

    await expect(
      upgradeManager.disownProxyAdmin(proxyAdmin.address, otherOwner)
    )
      .to.emit(proxyAdmin, "OwnershipTransferred")
      .withArgs(upgradeManager.address, otherOwner);

    expect(await proxyAdmin.owner()).to.eq(
      otherOwner,
      "The proxy admin ownership is now transferred"
    );
  });

  it("validates proxy uniqueness (by proxy address) when adopting", async () => {
    let { instance, proxyAdmin } = await deployAndAdoptContract();

    await expect(
      upgradeManager.adoptContract(
        "Duplicate",
        instance.address,
        proxyAdmin.address
      )
    ).to.be.rejectedWith("Proxy already adopted with a different contract id");
  });

  it("validates the proposed address", async () => {
    let { instance: instance } = await deployAndAdoptContract({ id: "C1" });

    let implementationAddress = await getImplementationAddress(
      instance.address
    );
    upgradeManager = await contractWithSigner(upgradeManager, proposer);

    await expect(
      upgradeManager.proposeUpgrade("C1", implementationAddress)
    ).to.be.rejectedWith("Implementation address unchanged");

    await expect(
      upgradeManager.proposeUpgradeAndCall(
        "C1",
        implementationAddress,
        encodeWithSignature("setup(string)", "baz")
      )
    ).to.be.rejectedWith("Implementation address unchanged");

    await expect(
      upgradeManager.proposeUpgrade("C1", randomEOA)
    ).to.be.rejectedWith("Implementation address is not a contract");
    await expect(
      upgradeManager.proposeUpgradeAndCall(
        "C1",
        randomEOA,
        encodeWithSignature("setup(string)", "baz")
      )
    ).to.be.rejectedWith("Implementation address is not a contract");
  });

  it("should be possible to self upgrade if it ends up being the owner of its own proxyadmin", async () => {
    clearManifest();

    upgradeManager = (await deployProxy(UpgradeManager, [
      owner,
    ])) as UpgradeManager;

    await upgradeManager.setup([proposer]);

    expect(await upgradeManager.version()).to.eq("");
    await upgradeManager.upgrade("1.0.0", "0");
    expect(await upgradeManager.version()).to.eq("1.0.0");

    let upgradeManagerProxyAdminAddress = await getAdminAddress(
      upgradeManager.address
    );
    let upgradeManagerProxyAdmin = await ethers.getContractAt(
      "IProxyAdmin",
      upgradeManagerProxyAdminAddress
    );
    expect(await upgradeManagerProxyAdmin.owner()).to.eq(owner);

    let { proxyAdmin } = await deployAndAdoptContract();

    expect(upgradeManagerProxyAdminAddress).to.eq(proxyAdmin.address);
    expect(await proxyAdmin.owner()).to.eq(upgradeManager.address);

    let UpgradedUpgradeManager = await ethers.getContractFactory(
      "UpgradedUpgradeManager"
    );
    let newImplementation = await UpgradedUpgradeManager.deploy();

    await expect(
      (
        await contractWithSigner(upgradeManager, randomEOA)
      ).selfUpgrade(
        newImplementation.address,
        upgradeManagerProxyAdminAddress,
        { from: randomEOA }
      )
    ).to.be.rejectedWith("Ownable: caller is not the owner");
    await expect(
      upgradeManager.selfUpgrade(AddressZero, upgradeManagerProxyAdminAddress)
    ).to.be.rejectedWith("Implementation address is not a contract");
    await expect(
      upgradeManager.selfUpgrade(randomEOA, upgradeManagerProxyAdminAddress)
    ).to.be.rejectedWith("Implementation address is not a contract");
    await upgradeManager.selfUpgrade(
      newImplementation.address,
      upgradeManagerProxyAdminAddress
    );
    let upgradedUpgradeManager = await ethers.getContractAt(
      "UpgradedUpgradeManager",
      upgradeManager.address
    );
    expect(await upgradedUpgradeManager.newFunction()).to.eq(
      "UpgradedUpgradeManager"
    );
    expect(await upgradedUpgradeManager.version()).to.eq("1.0.0");
  });

  it("only allows 100 contracts maxiumum", async () => {
    for (let i = 0; i < 100; i++) {
      await deployAndAdoptContract({ id: `C${i}` });
    }

    await expect(
      deployAndAdoptContract({ id: "last contract" })
    ).to.be.rejectedWith("Too many contracts adopted");
  });

  describe("Proposing abstract contract", async () => {
    let abstract1: AbstractContractV1;
    beforeEach(async () => {
      abstract1 = await AbstractContractV1.deploy();
      expect(await abstract1.version()).to.eq("1");
    });

    it("allows a proposer to propose an abstract contract address", async () => {
      expect(
        await upgradeManager.getAbstractContractAddress("AbstractContract")
      ).to.eq(AddressZero);

      await expect(
        upgradeManager.proposedAbstractContracts(0)
      ).to.be.rejectedWith("call revert exception");
      expect(await upgradeManager.getAbstractContractIdHashes()).to.be.empty;

      await expect(
        upgradeManagerAsProposer.proposeAbstract(
          "AbstractContract",
          abstract1.address
        )
      )
        .to.emit(upgradeManagerAsProposer, "AbstractProposed")
        .withArgs("AbstractContract", abstract1.address);

      let prop1 = await upgradeManager.proposedAbstractContracts(0);
      expect(await upgradeManager.getAbstractContractAddresses()).to.be.empty;
      expect(await upgradeManager.getAbstractContractIdHashes()).to.be.empty;

      expect(prop1.id).to.eq("AbstractContract");
      expect(prop1.contractAddress).to.eq(abstract1.address);

      await expect(
        upgradeManager.proposedAbstractContracts(1)
      ).to.be.rejectedWith("call revert exception");

      await upgradeManagerAsProposer.proposeAbstract(
        "AbstractContractSameImplementationDifferentName",
        abstract1.address
      );

      let prop2 = await upgradeManager.proposedAbstractContracts(1);
      expect(prop2.id).to.eq("AbstractContractSameImplementationDifferentName");
      expect(prop2.contractAddress).to.eq(abstract1.address);

      expect(
        await upgradeManager.getAbstractContractAddress("AbstractContract")
      ).to.eq(AddressZero);

      expect(
        await upgradeManager.getAbstractContractAddress(
          "AbstractContractSameImplementationDifferentName"
        )
      ).to.eq(AddressZero);

      await upgradeManager.upgrade("1", await upgradeManager.nonce());
      expect(
        await upgradeManager.getAbstractContractAddresses()
      ).to.have.members([abstract1.address, abstract1.address]);

      expect(
        await upgradeManager.getAbstractContractIdHashes()
      ).to.have.members([
        solidityKeccak256(["string"], ["AbstractContract"]),
        solidityKeccak256(
          ["string"],
          ["AbstractContractSameImplementationDifferentName"]
        ),
      ]);

      expect(
        await upgradeManager.getAbstractContractAddress("AbstractContract")
      ).to.eq(abstract1.address);

      expect(
        await upgradeManager.getAbstractContractAddress(
          "AbstractContractSameImplementationDifferentName"
        )
      ).to.eq(abstract1.address);

      await expect(
        upgradeManager.proposedAbstractContracts(0)
      ).to.be.rejectedWith("call revert exception");

      await expect(
        upgradeManager.proposedAbstractContracts(1)
      ).to.be.rejectedWith("call revert exception");

      let abstract2 = await AbstractContractV2.deploy();
      await upgradeManagerAsProposer.proposeAbstract(
        "AbstractContract",
        abstract2.address
      );
      expect(
        await upgradeManager.getAbstractContractAddress("AbstractContract")
      ).to.eq(abstract1.address);
      await upgradeManager.upgrade("2", await upgradeManager.nonce());
      expect(
        await upgradeManager.getAbstractContractAddress("AbstractContract")
      ).to.eq(abstract2.address);
      expect(
        await upgradeManager.getAbstractContractIdHashes()
      ).to.have.members([
        solidityKeccak256(["string"], ["AbstractContract"]),
        solidityKeccak256(
          ["string"],
          ["AbstractContractSameImplementationDifferentName"]
        ),
      ]);
      expect(
        await upgradeManager.getAbstractContractAddresses()
      ).to.have.members([abstract1.address, abstract2.address]);

      await upgradeManagerAsProposer.proposeAbstract(
        "AbstractContract",
        AddressZero
      );
      await upgradeManager.upgrade("3", await upgradeManager.nonce());
      expect(
        await upgradeManager.getAbstractContractAddress("AbstractContract")
      ).to.eq(AddressZero);
      expect(
        await upgradeManager.getAbstractContractAddresses()
      ).to.have.members([abstract1.address]);

      expect(
        await upgradeManager.getAbstractContractIdHashes()
      ).to.have.members([
        solidityKeccak256(
          ["string"],
          ["AbstractContractSameImplementationDifferentName"]
        ),
      ]);

      let abstractContractStruct = await upgradeManager.abstractContracts(
        solidityKeccak256(["string"], ["AbstractContract"])
      );
      expect(abstractContractStruct.id).to.eq("");
      expect(abstractContractStruct.contractAddress).to.eq(AddressZero);
    });

    it("only allows proposers to call", async () => {
      await expect(
        upgradeManager.proposeAbstract("AbstractContract", abstract1.address)
      ).to.be.rejectedWith("Caller is not proposer");
    });

    it("last proposed address for abstract contract wins", async () => {
      let abstract2 = await AbstractContractV1.deploy();
      await upgradeManagerAsProposer.proposeAbstract(
        "AbstractContract",
        abstract1.address
      );
      await upgradeManagerAsProposer.proposeAbstract(
        "AbstractContract",
        abstract2.address
      );
      await upgradeManager.upgrade("1", await upgradeManager.nonce());
      expect(
        await upgradeManager.getAbstractContractAddress("AbstractContract")
      ).to.eq(abstract2.address);
    });

    it("allows to withdraw all abstract contract proposals", async () => {
      await upgradeManagerAsProposer.proposeAbstract(
        "AbstractContract",
        abstract1.address
      );
      await expect(
        upgradeManager.withdrawAllAbstractProposals()
      ).to.be.rejectedWith("Caller is not proposer");
      await expect(
        upgradeManagerAsProposer.withdrawAllAbstractProposals()
      ).to.emit(upgradeManagerAsProposer, "AbstractProposalsWithdrawn");
      await upgradeManager.upgrade("1", await upgradeManager.nonce());
      expect(
        await upgradeManager.getAbstractContractAddress("AbstractContract")
      ).to.eq(AddressZero);
    });
    it("requires a contract address", async () => {
      await expect(
        upgradeManagerAsProposer.proposeAbstract("AbstractContract", proposer)
      ).to.be.rejectedWith("Proposed address is not a contract");
    });
  });

  // describe("Future", function () {
  //   it("has meaningful version storage not string");
  //   it("has support for pausing all contracts that support pause")
  //   it("allows bulk resetting changes")
  // });
});
