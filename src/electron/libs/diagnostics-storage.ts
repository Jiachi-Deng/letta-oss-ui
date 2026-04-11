import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DiagnosticIncidentSample, DiagnosticSummary } from "../../shared/diagnostics.js";

export const MAX_STORED_DIAGNOSTIC_TRACES = 50;
export const MAX_STORED_DIAGNOSTIC_INCIDENTS = 100;
const DIAGNOSTICS_STORAGE_DIR = "diagnostics";
const DIAGNOSTICS_STORAGE_FILE = "traces.json";
const DIAGNOSTIC_INCIDENTS_STORAGE_FILE = "incidents.json";
const DIAGNOSTICS_STORAGE_VERSION = 1;

type DiagnosticsSnapshot = {
  version: number;
  traces: DiagnosticSummary[];
};

type DiagnosticIncidentsSnapshot = {
  version: number;
  incidents: DiagnosticIncidentSample[];
};

export function getDiagnosticsStoragePath(userDataPath: string): string {
  return join(userDataPath, DIAGNOSTICS_STORAGE_DIR, DIAGNOSTICS_STORAGE_FILE);
}

export function getDiagnosticIncidentStoragePath(userDataPath: string): string {
  return join(userDataPath, DIAGNOSTICS_STORAGE_DIR, DIAGNOSTIC_INCIDENTS_STORAGE_FILE);
}

function isDiagnosticSummary(value: unknown): value is DiagnosticSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as DiagnosticSummary;
  return typeof summary.traceId === "string"
    && typeof summary.summary === "string"
    && Array.isArray(summary.steps);
}

function isDiagnosticIncidentSample(value: unknown): value is DiagnosticIncidentSample {
  if (!isDiagnosticSummary(value)) return false;
  const incident = value as DiagnosticIncidentSample;
  return typeof incident.fingerprint === "string"
    && typeof incident.capturedAt === "string"
    && typeof incident.lastSeenAt === "string"
    && typeof incident.occurrenceCount === "number"
    && Array.isArray(incident.recentTraceIds);
}

function normalizeSnapshot(snapshot: unknown): DiagnosticSummary[] {
  if (!snapshot || typeof snapshot !== "object") return [];

  const traces = (snapshot as Partial<DiagnosticsSnapshot>).traces;
  if (!Array.isArray(traces)) return [];

  return traces.filter(isDiagnosticSummary).map((trace) => ({
    ...trace,
    steps: trace.steps.map((step) => ({ ...step })),
  }));
}

function normalizeIncidentSnapshot(snapshot: unknown): DiagnosticIncidentSample[] {
  if (!snapshot || typeof snapshot !== "object") return [];

  const incidents = (snapshot as Partial<DiagnosticIncidentsSnapshot>).incidents;
  if (!Array.isArray(incidents)) return [];

  return incidents.filter(isDiagnosticIncidentSample).map((incident) => ({
    ...incident,
    recentTraceIds: incident.recentTraceIds.slice(),
    steps: incident.steps.map((step) => ({ ...step })),
  }));
}

export function readPersistedDiagnosticSummaries(userDataPath: string): DiagnosticSummary[] {
  const storagePath = getDiagnosticsStoragePath(userDataPath);
  if (!existsSync(storagePath)) return [];

  try {
    const raw = readFileSync(storagePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeSnapshot(parsed);
  } catch (error) {
    console.warn("[diagnostics] Failed to read persisted diagnostics snapshot:", storagePath, error);
    return [];
  }
}

export function readPersistedDiagnosticIncidentSamples(userDataPath: string): DiagnosticIncidentSample[] {
  const storagePath = getDiagnosticIncidentStoragePath(userDataPath);
  if (!existsSync(storagePath)) return [];

  try {
    const raw = readFileSync(storagePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeIncidentSnapshot(parsed);
  } catch (error) {
    console.warn("[diagnostics] Failed to read persisted incident snapshot:", storagePath, error);
    return [];
  }
}

export function writePersistedDiagnosticSummaries(
  userDataPath: string,
  traces: DiagnosticSummary[],
): void {
  try {
    const storagePath = getDiagnosticsStoragePath(userDataPath);
    mkdirSync(dirname(storagePath), { recursive: true });
    const snapshot: DiagnosticsSnapshot = {
      version: DIAGNOSTICS_STORAGE_VERSION,
      traces: traces.slice(0, MAX_STORED_DIAGNOSTIC_TRACES).map((trace) => ({
        ...trace,
        steps: trace.steps.map((step) => ({ ...step })),
      })),
    };

    writeFileSync(storagePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
  } catch (error) {
    console.warn("[diagnostics] Failed to write persisted diagnostics snapshot:", error);
  }
}

export function writePersistedDiagnosticIncidentSamples(
  userDataPath: string,
  incidents: DiagnosticIncidentSample[],
): void {
  try {
    const storagePath = getDiagnosticIncidentStoragePath(userDataPath);
    mkdirSync(dirname(storagePath), { recursive: true });
    const snapshot: DiagnosticIncidentsSnapshot = {
      version: DIAGNOSTICS_STORAGE_VERSION,
      incidents: incidents.slice(0, MAX_STORED_DIAGNOSTIC_INCIDENTS).map((incident) => ({
        ...incident,
        recentTraceIds: incident.recentTraceIds.slice(),
        steps: incident.steps.map((step) => ({ ...step })),
      })),
    };

    writeFileSync(storagePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
  } catch (error) {
    console.warn("[diagnostics] Failed to write persisted incident snapshot:", error);
  }
}
