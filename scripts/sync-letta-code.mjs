import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = resolve(scriptDir, "..");
const workspaceRoot = resolve(workspaceDir, "../..");
const lettaCodeCandidates = [
  resolve(workspaceRoot, "vendor/letta-code"),
  resolve(workspaceDir, "../letta-code"),
];
const sourceDir = lettaCodeCandidates.find((candidate) => existsSync(candidate)) ?? lettaCodeCandidates[0];

const packagePaths = [
  resolve(workspaceDir, "node_modules/@letta-ai/letta-code"),
];

const entriesToCopy = [
  "LICENSE",
  "package.json",
  "letta.js",
  "dist",
  "scripts",
  "skills",
  "vendor",
];

function syncPackage(targetDir) {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  for (const entry of entriesToCopy) {
    const from = join(sourceDir, entry);
    if (!existsSync(from)) {
      throw new Error(`Missing letta-code build artifact: ${from}`);
    }
    cpSync(from, join(targetDir, entry), {
      recursive: true,
      force: true,
    });
  }
}

for (const targetDir of packagePaths) {
  syncPackage(targetDir);
  console.log(`[sync-letta-code] synced ${targetDir}`);
}

const nestedCopy = resolve(
  workspaceDir,
  "node_modules/@letta-ai/letta-code-sdk/node_modules/@letta-ai/letta-code",
);
rmSync(nestedCopy, { recursive: true, force: true });
console.log(`[sync-letta-code] removed nested SDK copy ${nestedCopy}`);
