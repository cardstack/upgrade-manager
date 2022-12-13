// Importing app code from the test helpers breaks hardhat environment fixtures for some reason,
// Likely due to requiring the hre before the tests start running.

import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { HardhatPluginError } from "hardhat/plugins";
import { Artifact } from "hardhat/types";

export const PLUGIN_NAME = "upgrade-manager";

// Helpers useful in both tests and plugin task code should live here and be imported from each

export function getErrorMessageAndStack(error: unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error) return error;
  return { message: String(error), stack: new Error().stack };
}

export function readArtifactFromPlugin(artifactName: string): Artifact {
  let path = join(__dirname, `./${artifactName}.sol.json`);
  if (!existsSync(path)) {
    throw new HardhatPluginError(
      PLUGIN_NAME,
      `Could not locate compiled artifact ${artifactName} at ${path}, run yarn compile`
    );
  }
  let artifact: Artifact = JSON.parse(readFileSync(path, "utf-8"));

  return artifact;
}
