import { asyncMain } from "./util";
import { config, artifacts } from "hardhat";
import { join } from "path";
import { writeFileSync } from "fs";

async function main() {
  await copyArtifact("UpgradeManager");
}

async function copyArtifact(contractName: string) {
  let artifact = await artifacts.readArtifact(contractName);
  let path = join(config.paths.root, `${contractName}.sol.json`);
  writeFileSync(path, JSON.stringify(artifact, null, 2));
  console.log("Wrote compilation artifact from", contractName, ".sol to", path);
}

asyncMain(main);
