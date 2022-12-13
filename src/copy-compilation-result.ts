import { writeFileSync } from "fs";
import { join } from "path";

import { config, artifacts } from "hardhat";

import { asyncMain } from "./util";

async function main() {
  await copyArtifact("UpgradeManager");
  await copyArtifact("IProxyAdmin");
  await copyArtifact("GnosisSafe");
  await copyArtifact("GnosisSafeProxyFactory");
}

async function copyArtifact(contractName: string) {
  let artifact = await artifacts.readArtifact(contractName);
  let path = join(config.paths.root, `${contractName}.sol.json`);
  writeFileSync(path, JSON.stringify(artifact, null, 2));
  console.log("Wrote compilation artifact from", contractName, ".sol to", path);
}

asyncMain(main);
