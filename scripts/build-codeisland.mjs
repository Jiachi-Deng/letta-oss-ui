import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const lettaUiRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(lettaUiRoot, "..");
const codeIslandRoot = path.join(repoRoot, "code-island");
const stageRoot = path.join(lettaUiRoot, "build-resources");
const stagedAppPath = path.join(stageRoot, "CodeIsland.app");

function resolveSwiftArch(arg) {
  if (arg === "arm64") return "arm64";
  if (arg === "x64" || arg === "x86_64") return "x86_64";

  if (process.arch === "arm64") return "arm64";
  return "x86_64";
}

function resolveBuiltAppPath(swiftArch) {
  const stablePath = path.join(codeIslandRoot, ".build", "release", "CodeIsland.app");
  if (existsSync(stablePath)) return stablePath;

  return path.join(
    codeIslandRoot,
    ".build",
    `${swiftArch}-apple-macosx`,
    "release",
    "CodeIsland.app",
  );
}

const requestedArch = process.argv[2];
const swiftArch = resolveSwiftArch(requestedArch);

console.log(`[codeisland-build] Building CodeIsland for ${swiftArch}...`);

const buildResult = spawnSync("bash", ["build_local.sh"], {
  cwd: codeIslandRoot,
  env: {
    ...process.env,
    CODEISLAND_ARCH_OVERRIDE: swiftArch,
  },
  stdio: "inherit",
});

if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const builtAppPath = resolveBuiltAppPath(swiftArch);
if (!existsSync(builtAppPath)) {
  console.error(`[codeisland-build] Built app not found at ${builtAppPath}`);
  process.exit(1);
}

mkdirSync(stageRoot, { recursive: true });
rmSync(stagedAppPath, { recursive: true, force: true });
cpSync(builtAppPath, stagedAppPath, { recursive: true });

console.log(`[codeisland-build] Staged CodeIsland.app at ${stagedAppPath}`);
