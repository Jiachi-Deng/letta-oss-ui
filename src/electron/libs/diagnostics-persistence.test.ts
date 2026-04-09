import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  getDiagnosticsStoragePath,
  readPersistedDiagnosticSummaries,
  writePersistedDiagnosticSummaries,
  MAX_STORED_DIAGNOSTIC_TRACES,
} from "./diagnostics-storage.js";
import {
  flushDiagnosticsPersistence,
  getDiagnosticSummary,
  initializeDiagnosticsPersistence,
  resetDiagnosticsForTests,
} from "./diagnostics.js";
import { emitStructuredLog, resetTraceObservers, resetTraceSink } from "./trace.js";
import { IPC_START_001 } from "../../shared/decision-ids.js";

describe("diagnostics persistence", () => {
  let userDataPath: string;

  beforeEach(() => {
    userDataPath = fs.mkdtempSync(join(tmpdir(), "letta-diagnostics-"));
    resetDiagnosticsForTests();
    resetTraceSink();
    resetTraceObservers();
    initializeDiagnosticsPersistence(userDataPath);
  });

  afterEach(() => {
    resetDiagnosticsForTests();
    vi.restoreAllMocks();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  });

  it("persists traces to disk and restores them on restart", () => {
    emitStructuredLog({
      level: "info",
      component: "ipc",
      trace_id: "trc_persist",
      turn_id: "turn_persist",
      session_id: "conv_persist",
      decision_id: IPC_START_001,
      message: "persisted trace",
      ts: "2026-04-09T18:00:00.000Z",
    });

    flushDiagnosticsPersistence();

    const storagePath = getDiagnosticsStoragePath(userDataPath);
    expect(readPersistedDiagnosticSummaries(userDataPath)).toHaveLength(1);
    expect(storagePath).toContain("diagnostics/traces.json");

    resetDiagnosticsForTests();
    initializeDiagnosticsPersistence(userDataPath);

    expect(getDiagnosticSummary("trc_persist")).toMatchObject({
      traceId: "trc_persist",
      sessionId: "conv_persist",
      turnId: "turn_persist",
      stepCount: 1,
    });
  });

  it("caps persisted traces to the configured maximum", () => {
    for (let index = 0; index < MAX_STORED_DIAGNOSTIC_TRACES + 10; index += 1) {
      const traceNumber = String(index).padStart(3, "0");
      emitStructuredLog({
        level: "info",
        component: "runner",
        trace_id: `trc_${traceNumber}`,
        turn_id: `turn_${traceNumber}`,
        session_id: `conv_${traceNumber}`,
        decision_id: IPC_START_001,
        message: `trace ${traceNumber}`,
        ts: new Date(Date.UTC(2026, 3, 9, 18, 0, index)).toISOString(),
      });
    }

    flushDiagnosticsPersistence();

    const persisted = readPersistedDiagnosticSummaries(userDataPath);
    expect(persisted).toHaveLength(MAX_STORED_DIAGNOSTIC_TRACES);
    expect(persisted[0]?.traceId).toBe(`trc_${String(MAX_STORED_DIAGNOSTIC_TRACES + 9).padStart(3, "0")}`);
    expect(persisted[persisted.length - 1]?.traceId).toBe("trc_010");
  });

  it("warns and fails soft when the persisted file is unreadable", () => {
    const storagePath = getDiagnosticsStoragePath(userDataPath);
    fs.mkdirSync(dirname(storagePath), { recursive: true });
    fs.writeFileSync(storagePath, "{not-json", "utf-8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const traces = readPersistedDiagnosticSummaries(userDataPath);

    expect(traces).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("warns and fails soft when write persistence throws", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const storageDir = dirname(getDiagnosticsStoragePath(userDataPath));
    fs.mkdirSync(storageDir, { recursive: true });
    fs.chmodSync(storageDir, 0o555);

    try {
      expect(() => {
        writePersistedDiagnosticSummaries(userDataPath, []);
      }).not.toThrow();

      expect(warnSpy).toHaveBeenCalled();
    } finally {
      fs.chmodSync(storageDir, 0o755);
    }
  });
});
