import { existsSync, readFileSync, unlinkSync } from "fs";
import { readJSONSync } from "fs-extra";
import { resetHardhatContext } from "hardhat/plugins-testing";
import { Artifact, HardhatRuntimeEnvironment } from "hardhat/types";
import { Context } from "mocha";
import path from "path";
import rmrf from "rmrf";
import { stdout } from "test-console";
import { getErrorMessageAndStack } from "../shared";
import { UpgradeManager } from "../typechain-types";
declare module "mocha" {
  interface Context {
    hre: HardhatRuntimeEnvironment;
    usedEnvironment?: string;
  }
}

function resetFixture(environment = "upgrade-managed-project") {
  let fixturePath = path.join(__dirname, "fixture-projects", environment);

  rmrf(path.join(fixturePath, ".openzeppelin"));
  let umMetaPath = path.join(
    fixturePath,
    "upgrade-manager-deploy-data-hardhat.json"
  );
  if (existsSync(umMetaPath)) {
    unlinkSync(umMetaPath);
  }
}

export function useEnvironment(fixtureProjectName: string) {
  beforeEach("Loading hardhat environment", async function () {
    if (this.usedEnvironment) {
      throw new Error(
        `Environment ${this.usedEnvironment} already active, cannot activate ${fixtureProjectName}`
      );
    }
    process.chdir(path.join(__dirname, "fixture-projects", fixtureProjectName));

    this.hre = require("hardhat");
    this.usedEnvironment = fixtureProjectName;

    resetFixture(this.usedEnvironment);

    await captureOutput(() => this.hre.run("compile"));
  });

  afterEach("Resetting hardhat", function () {
    resetFixture(this.usedEnvironment);

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
    context.usedEnvironment || "never",
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

interface ConsoleCapturedResult<T> {
  result: T | undefined;
  stdout: string;
  logs: string[];
}

export async function captureOutput<T>(
  cb: () => T
): Promise<ConsoleCapturedResult<T>> {
  let result: T | undefined;

  const inspect = stdout.inspect();
  try {
    result = await cb();
  } catch (e) {
    inspect.restore();
    let { message } = getErrorMessageAndStack(e);
    console.log("Error when capturing output:", e, "\n", message);
    console.log("\nOutput:\n\n", ...inspect.output);
    throw e;
  }
  inspect.restore();

  let output = inspect.output;

  return {
    stdout: output.join(""),
    result,
    logs: output.map((l) => l.slice(0, -1)),
  };
}

export async function runTask(
  hre: HardhatRuntimeEnvironment,
  task: string,
  taskArguments?: unknown
): Promise<ConsoleCapturedResult<Promise<unknown>>> {
  return await captureOutput(() => hre.run(task, taskArguments));
}
