import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildIncidentFingerprint,
  buildIncidentFileName,
  createIncidentPack,
  inferEnvironment,
  resolveWorkspaceRoot,
  sanitizeConfigSnapshot,
  synthesizeIncidentsFromTraces,
} from "./lib/incident-pack.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
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

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

const userDataPath = path.resolve(
  readArg("--user-data")
    ?? path.join(os.homedir(), "Library", "Application Support", "Letta"),
);
const diagnosticsDir = path.join(userDataPath, "diagnostics");
const tracesPath = path.join(diagnosticsDir, "traces.json");
const incidentsPath = path.join(diagnosticsDir, "incidents.json");
const configPath = path.join(userDataPath, "config.json");
const outDir = path.resolve(readArg("--out-dir") ?? path.join(workspaceRoot, "evals", "incidents", "normalized"));
const limit = Number.parseInt(readArg("--limit") ?? "20", 10);
const filterFingerprint = readArg("--fingerprint");
const filterTraceId = readArg("--trace-id");
const mode = readArg("--mode") ?? "unknown";
const surface = readArg("--surface") ?? "desktop";
const strict = hasFlag("--strict");
const appVersion = JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8")).version;

const tracesSnapshot = readJsonIfExists(tracesPath);
const incidentsSnapshot = readJsonIfExists(incidentsPath);
const config = readJsonIfExists(configPath) ?? {};

if (!tracesSnapshot?.traces || !Array.isArray(tracesSnapshot.traces)) {
  console.error(`[generate-incident-pack] Missing or invalid trace archive: ${tracesPath}`);
  process.exit(1);
}

const tracesById = new Map(tracesSnapshot.traces.map((trace) => [trace.traceId, trace]));
const incidentSource = incidentsSnapshot?.incidents && Array.isArray(incidentsSnapshot.incidents)
  ? incidentsSnapshot.incidents
  : synthesizeIncidentsFromTraces(tracesSnapshot.traces);
const environment = inferEnvironment(config, {
  surface,
  mode,
  appVersion,
  appRepoPath: appRoot,
});
const configSnapshot = sanitizeConfigSnapshot(config);

const incidents = incidentSource
  .filter((incident) => !filterFingerprint || incident.fingerprint === filterFingerprint)
  .filter((incident) => {
    const fingerprint = incident.fingerprint ?? buildIncidentFingerprint(incident);
    return !filterTraceId
      || incident.traceId === filterTraceId
      || incident.recentTraceIds?.includes(filterTraceId)
      || fingerprint.includes(filterTraceId);
  })
  .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 20);

if (incidents.length === 0) {
  const reason = (!incidentsSnapshot?.incidents || !Array.isArray(incidentsSnapshot.incidents))
    ? "No incident archive exists yet, and traces.json currently contains no failed traces."
    : "No incidents matched the requested filters.";
  const log = strict ? console.error : console.log;
  log(`[generate-incident-pack] ${reason}`);
  process.exit(strict ? 1 : 0);
}

mkdirSync(outDir, { recursive: true });

const writtenPaths = [];
for (const incident of incidents) {
  const primaryTraceId = incident.recentTraceIds?.[0] ?? incident.traceId;
  const primaryTrace = tracesById.get(primaryTraceId) ?? tracesById.get(incident.traceId) ?? incident;
  const relatedTraces = (incident.recentTraceIds ?? [])
    .map((traceId) => tracesById.get(traceId))
    .filter(Boolean)
    .slice(0, 10);

  const pack = createIncidentPack({
    incident,
    primaryTrace,
    relatedTraces,
    environment,
    configSnapshot,
    paths: {
      userDataPath,
      traceStoragePath: tracesPath,
      incidentStoragePath: incidentsPath,
    },
  });

  const filePath = path.join(outDir, buildIncidentFileName(incident));
  writeFileSync(filePath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  writtenPaths.push(filePath);
}

console.log(`[generate-incident-pack] Wrote ${writtenPaths.length} incident pack(s) to ${outDir}`);
if (!incidentsSnapshot?.incidents || !Array.isArray(incidentsSnapshot.incidents)) {
  console.log("[generate-incident-pack] Note: incidents.json was missing; incident packs were synthesized from failed traces.");
}
for (const filePath of writtenPaths) {
  console.log(`  - ${filePath}`);
}

if (hasFlag("--print")) {
  for (const filePath of writtenPaths) {
    console.log(`\n--- ${filePath} ---`);
    console.log(readFileSync(filePath, "utf8"));
  }
}
