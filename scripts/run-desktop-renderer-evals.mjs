import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDesktopRendererEvalCase } from "./lib/desktop-renderer-runner.js";
import { resolveReleaseConfigPath } from "./lib/release-config.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(appRoot, "../..");
const args = process.argv.slice(2);

function readArg(flag) {
  const index = args.findIndex((value) => value === flag);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

const appPath = path.resolve(readArg("--app") ?? path.join(appRoot, "dist", "mac-arm64", "Letta.app"));
const casesRoot = path.resolve(readArg("--cases-root") ?? path.join(workspaceRoot, "evals", "cases"));
const reportsRoot = path.resolve(readArg("--reports-root") ?? path.join(workspaceRoot, "evals", "reports", "latest"));
const caseFilter = readArg("--case");
const configArgPath = readArg("--config");

function collectCaseFiles(rootDir) {
  const directories = [
    path.join(rootDir, "desktop"),
    path.join(rootDir, "packaged"),
  ];
  const results = [];

  for (const dir of directories) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const filePath = path.join(dir, entry);
      if (entry.endsWith(".case.json")) {
        results.push(filePath);
      }
    }
  }

  return results.sort();
}

if (!existsSync(appPath)) {
  console.error(`[run-desktop-renderer-evals] Missing app bundle: ${appPath}`);
  process.exit(1);
}

let releaseConfigPath = null;
let releaseConfigSource = null;
try {
  const resolved = resolveReleaseConfigPath({
    workspaceRoot,
    cliArgPath: configArgPath,
  });
  releaseConfigPath = resolved.configPath;
  releaseConfigSource = resolved.sourceLabel;
} catch (error) {
  console.error(`[run-desktop-renderer-evals] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const caseFiles = collectCaseFiles(casesRoot)
  .filter((filePath) => !caseFilter || filePath.includes(caseFilter));

if (caseFiles.length === 0) {
  console.error(`[run-desktop-renderer-evals] No desktop eval cases found under ${casesRoot}`);
  process.exit(1);
}

mkdirSync(reportsRoot, { recursive: true });
console.log(`[run-desktop-renderer-evals] Using release config from ${releaseConfigSource}: ${releaseConfigPath}`);

let failures = 0;
for (const caseFile of caseFiles) {
  const evalCase = JSON.parse(readFileSync(caseFile, "utf8"));
  if (evalCase.surface !== "desktop") {
    continue;
  }
  if (evalCase.mode !== "packaged") {
    continue;
  }

  const reportPath = path.join(
    reportsRoot,
    `${path.basename(caseFile, ".case.json")}.renderer.report.json`,
  );

  try {
    console.log(`[run-desktop-renderer-evals] Running ${evalCase.id}`);
    await runDesktopRendererEvalCase({
      evalCase,
      appPath,
      configPath: releaseConfigPath,
      reportPath,
    });
    console.log(`[run-desktop-renderer-evals] PASS ${evalCase.id}`);
  } catch (error) {
    failures += 1;
    console.error(`[run-desktop-renderer-evals] FAIL ${evalCase.id}`);
    console.error(error instanceof Error ? error.message : String(error));
  }
}

if (failures > 0) {
  process.exit(1);
}
