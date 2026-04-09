import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const lettaUiRoot = path.resolve(scriptDir, "..");
const stageRoot = path.join(lettaUiRoot, "build-resources", "LettaServer");
const repoRoot = path.resolve(lettaUiRoot, "..");
const stagePythonPath = path.join(stageRoot, "venv", "bin", "python3");
const stagePythonHome = path.join(stageRoot, "python-base", "Python.framework", "Versions", "3.11");
const stagePthPath = path.join(
  stageRoot,
  "venv",
  "lib",
  "python3.11",
  "site-packages",
  "_letta.pth",
);
const DIST_INFO_METADATA_FILES = new Set(["INSTALLER", "RECORD", "REQUESTED", "direct_url.json"]);
const TRANSIENT_DIR_NAMES = new Set(["__pycache__", ".pytest_cache", "tests", "test", "testing"]);
const TRANSIENT_ROOT_PREFIXES = ["server-home", "logs"];

function fail(message) {
  console.error(`[verify-letta-server] ${message}`);
  process.exit(1);
}

if (!existsSync(stageRoot)) {
  fail(`Missing staged Letta server directory at ${stageRoot}`);
}

if (!existsSync(stagePythonPath)) {
  fail(`Missing staged python runtime at ${stagePythonPath}`);
}

if (!existsSync(path.join(stagePythonHome, "Python"))) {
  fail(`Missing bundled Python framework runtime at ${stagePythonHome}`);
}

if (!existsSync(stagePthPath)) {
  fail(`Missing staged editable path file at ${stagePthPath}`);
}

const pthContents = readFileSync(stagePthPath, "utf8").trim();
if (pthContents.includes("/build-resources/") || pthContents.includes(stageRoot)) {
  fail(`Staged editable path file still contains an absolute build path: ${pthContents}`);
}

const pyvenvContents = readFileSync(path.join(stageRoot, "venv", "pyvenv.cfg"), "utf8");
if (pyvenvContents.includes("/opt/homebrew/")) {
  fail(`Staged pyvenv.cfg still references Homebrew paths:\n${pyvenvContents}`);
}
if (pyvenvContents.includes("/build-resources/") || pyvenvContents.includes(stageRoot) || pyvenvContents.includes(repoRoot)) {
  fail(`Staged pyvenv.cfg still references build/workspace paths:\n${pyvenvContents}`);
}

const otool = spawnSync("otool", ["-L", stagePythonPath], {
  encoding: "utf8",
  stdio: "pipe",
});

if (otool.status !== 0) {
  fail(`Unable to inspect staged python binary with otool: ${otool.stderr || otool.stdout}`);
}

if ((otool.stdout || "").includes("/opt/homebrew/")) {
  fail(`Staged python binary still references Homebrew runtime paths:\n${otool.stdout}`);
}

const forbiddenRootEntries = readdirSync(stageRoot).filter((name) =>
  TRANSIENT_ROOT_PREFIXES.some((prefix) => name.startsWith(prefix)),
);

if (forbiddenRootEntries.length > 0) {
  fail(`Found mutable root entries: ${forbiddenRootEntries.join(", ")}`);
}

const violations = [];
const stack = [stageRoot];
while (stack.length > 0) {
  const current = stack.pop();
  if (!current) continue;

  for (const entry of readdirSync(current)) {
    const entryPath = path.join(current, entry);
    const stats = lstatSync(entryPath);

    if (stats.isDirectory()) {
      if (TRANSIENT_DIR_NAMES.has(entry)) {
        violations.push(entryPath);
        continue;
      }
      stack.push(entryPath);
      continue;
    }

    if (entry.endsWith(".pyc") || entry.endsWith(".pyo")) {
      violations.push(entryPath);
      continue;
    }

    if (entry.endsWith(".db")) {
      violations.push(entryPath);
      continue;
    }

    if (DIST_INFO_METADATA_FILES.has(entry) && current.endsWith(".dist-info")) {
      violations.push(entryPath);
    }
  }
}

if (violations.length > 0) {
  const preview = violations.slice(0, 20).join("\n");
  fail(`Found forbidden staged artifacts:\n${preview}${violations.length > 20 ? `\n...and ${violations.length - 20} more` : ""}`);
}

console.log(`[verify-letta-server] OK: ${stageRoot}`);
