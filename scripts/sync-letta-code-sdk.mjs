import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = resolve(scriptDir, "..");
const workspaceRoot = resolve(workspaceDir, "../..");
const sdkCandidates = [
  resolve(workspaceRoot, "vendor/letta-code-sdk"),
  resolve(workspaceDir, "../letta-code-sdk"),
];
const sourceDir = sdkCandidates.find((candidate) => existsSync(candidate)) ?? sdkCandidates[0];

const packagePaths = [
  resolve(workspaceDir, "node_modules/@letta-ai/letta-code-sdk"),
];

const entriesToCopy = [
  "LICENSE",
  "README.md",
  "package.json",
  "dist",
];

function syncPackage(targetDir) {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  for (const entry of entriesToCopy) {
    const from = join(sourceDir, entry);
    if (!existsSync(from)) {
      throw new Error(`Missing letta-code-sdk build artifact: ${from}`);
    }
    cpSync(from, join(targetDir, entry), {
      recursive: true,
      force: true,
    });
  }
}

for (const targetDir of packagePaths) {
  syncPackage(targetDir);
  console.log(`[sync-letta-code-sdk] synced ${targetDir}`);
}
