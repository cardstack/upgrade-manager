import { resetHardhatContext } from "hardhat/plugins-testing";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import path from "path";
import { stdout } from "test-console";
import { getErrorMessageAndStack } from "../src/util";

declare module "mocha" {
  interface Context {
    hre: HardhatRuntimeEnvironment;
    usedEnvironment?: string;
  }
}

export function useEnvironment(fixtureProjectName: string) {
  beforeEach("Loading hardhat environment", function () {
    if (this.usedEnvironment) {
      throw new Error(
        `Environment ${this.usedEnvironment} already active, cannot activate ${fixtureProjectName}`
      );
    }
    process.chdir(path.join(__dirname, "fixture-projects", fixtureProjectName));

    this.hre = require("hardhat");
    this.usedEnvironment = fixtureProjectName;
  });

  afterEach("Resetting hardhat", function () {
    resetHardhatContext();
    this.usedEnvironment = undefined;
  });
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
