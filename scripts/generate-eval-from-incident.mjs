import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvalCaseFilePath, createEvalCaseFromIncidentPack } from "./lib/eval-case.js";
import { resolveWorkspaceRoot } from "./lib/incident-pack.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolveWorkspaceRoot(scriptDir);
const args = process.argv.slice(2);

function readArg(flag) {
  const index = args.findIndex((value) => value === flag);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

function hasFlag(flag) {
  return args.includes(flag);
}

function collectIncidentPackPaths(rootDir) {
  if (!existsSync(rootDir)) return [];

  return readdirSync(rootDir)
    .map((entry) => path.join(rootDir, entry))
    .filter((entryPath) => statSync(entryPath).isFile() && entryPath.endsWith(".json"))
    .sort();
}

const inDir = path.resolve(readArg("--in-dir") ?? path.join(workspaceRoot, "evals", "incidents", "normalized"));
const casesRoot = path.resolve(readArg("--out-dir") ?? path.join(workspaceRoot, "evals", "cases"));
const onlySurface = readArg("--surface");
const onlyFingerprint = readArg("--fingerprint");
const print = hasFlag("--print");
const strict = hasFlag("--strict");

const incidentPackPaths = collectIncidentPackPaths(inDir);
if (incidentPackPaths.length === 0) {
  const log = strict ? console.error : console.log;
  log(`[generate-eval-from-incident] No incident pack files found in ${inDir}`);
  process.exit(strict ? 1 : 0);
}

const writtenPaths = [];
for (const incidentPackPath of incidentPackPaths) {
  const pack = JSON.parse(readFileSync(incidentPackPath, "utf8"));
  if (onlySurface && pack.surface !== onlySurface) continue;
  if (onlyFingerprint && pack.fingerprint !== onlyFingerprint) continue;

  const evalCase = createEvalCaseFromIncidentPack(pack);
  evalCase.source.incidentPackPath = incidentPackPath;

  const filePath = buildEvalCaseFilePath({
    evalCase,
    incidentPackPath,
    casesRoot,
  });

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(evalCase, null, 2)}\n`, "utf8");
  writtenPaths.push(filePath);
}

if (writtenPaths.length === 0) {
  const log = strict ? console.error : console.log;
  log("[generate-eval-from-incident] No eval cases matched the requested filters.");
  process.exit(strict ? 1 : 0);
}

console.log(`[generate-eval-from-incident] Wrote ${writtenPaths.length} eval case draft(s) to ${casesRoot}`);
for (const filePath of writtenPaths) {
  console.log(`  - ${filePath}`);
}

if (print) {
  for (const filePath of writtenPaths) {
    console.log(`\n--- ${filePath} ---`);
    console.log(readFileSync(filePath, "utf8"));
  }
}
