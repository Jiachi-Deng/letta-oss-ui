import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DiagnosticSummary } from "../../shared/diagnostics.js";

export const MAX_STORED_DIAGNOSTIC_TRACES = 50;
const DIAGNOSTICS_STORAGE_DIR = "diagnostics";
const DIAGNOSTICS_STORAGE_FILE = "traces.json";
const DIAGNOSTICS_STORAGE_VERSION = 1;

type DiagnosticsSnapshot = {
  version: number;
  traces: DiagnosticSummary[];
};

export function getDiagnosticsStoragePath(userDataPath: string): string {
  return join(userDataPath, DIAGNOSTICS_STORAGE_DIR, DIAGNOSTICS_STORAGE_FILE);
}

function isDiagnosticSummary(value: unknown): value is DiagnosticSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as DiagnosticSummary;
  return typeof summary.traceId === "string"
    && typeof summary.summary === "string"
    && Array.isArray(summary.steps);
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
