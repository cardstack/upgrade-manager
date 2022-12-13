import { EventEmitter } from "events";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { hardhatChaiMatchers } from "@nomicfoundation/hardhat-chai-matchers/internal/hardhatChaiMatchers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import cpr from "cpr-promise";
import { readJSONSync } from "fs-extra";
import { resetHardhatContext } from "hardhat/plugins-testing";
import { Artifact, HardhatRuntimeEnvironment } from "hardhat/types";
import { Context } from "mocha";
import rmrf from "rmrf";
import { stdout } from "test-console";

import { getErrorMessageAndStack, readArtifactFromPlugin } from "../shared";
import {
  CREATE2_PROXY_DEPLOYMENT_COST,
  CREATE2_PROXY_DEPLOYMENT_SIGNER_ADDRESS,
  deployCreate2Contract,
  deployCreate2Proxy,
} from "../src/create2";
import { UpgradeManager } from "../typechain-types";

chai.use(chaiAsPromised);
chai.use(hardhatChaiMatchers);

declare module "mocha" {
  interface Context {
    hre: HardhatRuntimeEnvironment;
    usedEnvironment?: string;
  }
}

declare module "test-console" {
  interface Inspector extends EventEmitter {
    output: Output;
    restore: Restore;
  }
}

const tmpPath = path.join(__dirname, "fixture-projects", "tmp");

export function useEnvironment(fixtureProjectName: string) {
  beforeEach("Loading hardhat environment", async function () {
    if (this.usedEnvironment) {
      throw new Error(
        `Environment ${this.usedEnvironment} already active, cannot activate ${fixtureProjectName}`
      );
    }

    rmrf(tmpPath);

    let fixturePath = path.join(
      __dirname,
      "fixture-projects",
      fixtureProjectName
    );

    await cpr(fixturePath, tmpPath, { a: 1 });

    process.chdir(tmpPath);

    this.hre = require("hardhat");
    this.usedEnvironment = fixtureProjectName;

    await captureOutput(() => this.hre.run("compile"));
  });

  afterEach("Resetting hardhat", function () {
    rmrf(tmpPath);
    resetHardhatContext();
    this.usedEnvironment = undefined;
  });
}

export async function getFixtureProjectUpgradeManager(
  context: Context
): Promise<UpgradeManager> {
  let metadataPath = path.join(
    __dirname,
    "fixture-projects",
    "tmp",
    "config",
    "upgrade-manager-deploy-data-hardhat.json"
  );

  let upgradeManagerAddress: string =
    readJSONSync(metadataPath)["upgradeManagerAddress"];

  let jsonPath = path.join(__dirname, "../UpgradeManager.sol.json");
  if (!existsSync(jsonPath)) {
    throw new Error(
      `Could not locate compiled UpgradeManager at ${jsonPath}, run yarn compile`
    );
  }
  let artifact: Artifact = JSON.parse(readFileSync(jsonPath, "utf-8"));

  return (await context.hre.ethers.getContractAt(
    artifact.abi,
    upgradeManagerAddress
  )) as UpgradeManager;
}

export async function writeFixtureProjectFile(
  relPath: string,
  contents: string
) {
  let fullPath = path.join(__dirname, "fixture-projects", "tmp", relPath);

  writeFileSync(fullPath, contents, { encoding: "utf-8" });
}

interface ConsoleCapturedResult<T> {
  result: T | undefined;
  stdout: string;
  logs: string[];
}

export async function captureOutput<T>(
  cb: () => T
): Promise<ConsoleCapturedResult<T>> {
  let result: T | undefined;

  let originalWrite = process.stdout.write;

  const inspect = stdout.inspect();

  if (process.env.DEBUG_TASK_OUTPUT) {
    inspect.on("data", (d) => {
      originalWrite.call(process.stdout, d);
    });
  }

  try {
    result = await cb();
  } catch (e) {
    inspect.restore();
    let { message } = getErrorMessageAndStack(e);
    if (process.env.DEBUG_TASK_OUTPUT) {
      console.log("Error when capturing output:", e, "\n", message);
      console.log("\nOutput:\n\n", ...inspect.output);
    }
    throw e;
  } finally {
    inspect.restore();
  }

  inspect.restore();

  let output = inspect.output;
  return {
    stdout: output.join(""),
    result,
    logs: output.map((l) => l.slice(0, -1)),
  };
}

export async function runTask<T>(
  hre: HardhatRuntimeEnvironment,
  task: string,
  taskArguments?: unknown
): Promise<ConsoleCapturedResult<T>> {
  return await captureOutput(() => hre.run(task, taskArguments) as T);
}

export async function setupCreate2Proxy(hre: HardhatRuntimeEnvironment) {
  await setBalance(
    CREATE2_PROXY_DEPLOYMENT_SIGNER_ADDRESS,
    CREATE2_PROXY_DEPLOYMENT_COST
  );
  await deployCreate2Proxy(hre.ethers.provider);
}

export const HardhatFirstAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const HardhatSecondAddress =
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

export async function deployGnosisSafeProxyFactoryAndSingleton(
  hre: HardhatRuntimeEnvironment
): Promise<void> {
  let { abi, bytecode } = readArtifactFromPlugin("GnosisSafe");

  let GnosisSafe = await hre.ethers.getContractFactory(abi, bytecode);

  await deployCreate2Contract({
    signer: hre.ethers.provider.getSigner(),
    bytecode: GnosisSafe.bytecode,
  });

  ({ abi, bytecode } = readArtifactFromPlugin("GnosisSafeProxyFactory"));

  let GnosisSafeProxyFactory = await hre.ethers.getContractFactory(
    abi,
    bytecode
  );
  await deployCreate2Contract({
    signer: hre.ethers.provider.getSigner(),
    bytecode: GnosisSafeProxyFactory.bytecode,
  });
}
