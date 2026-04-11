import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { E_SERVER_EXITED_EARLY, E_SERVER_HEALTHCHECK_TIMEOUT } from "../../shared/error-codes.js";
import {
  SERVER_ALREADY_RUNNING_001,
  SERVER_EXIT_001,
  SERVER_HEALTHCHECK_001,
  SERVER_HEALTHCHECK_002,
  SERVER_RECOVERY_001,
  SERVER_RESOLVE_001,
  SERVER_START_001,
} from "../../shared/decision-ids.js";

const existsSyncMock = vi.hoisted(() => vi.fn<(path: string) => boolean>());
const mkdirSyncMock = vi.hoisted(() => vi.fn());
const appendFileSyncMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const electronAppState = vi.hoisted(() => ({
  isReady: () => true,
  getPath: (name: string) => {
    if (name === "userData") return "/tmp/letta-user-data";
    return "/tmp";
  },
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  mkdirSync: mkdirSyncMock,
  appendFileSync: appendFileSyncMock,
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("electron", () => ({
  app: electronAppState,
}));

function createChild(exitCode?: number): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  kill: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };

  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  child.kill = vi.fn();

  if (typeof exitCode === "number") {
    queueMicrotask(() => {
      child.emit("exit", exitCode, null);
    });
  }

  return child;
}

describe("bundled Letta server", () => {
  const originalResourcesPath = process.resourcesPath;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(process, "resourcesPath", {
      value: "/tmp/Resources",
      configurable: true,
    });
    vi.spyOn(process, "cwd").mockReturnValue("/Users/jachi/Desktop/letta-workspace/app/letta-desktop");
    existsSyncMock.mockImplementation((candidate) => {
      if (candidate === "/tmp/Resources/LettaServer/venv/bin/python3") return true;
      if (candidate === "/tmp/Resources/LettaServer/python-base/Python.framework/Versions/3.11") return true;
      if (candidate === "/tmp/Resources/LettaServer/nltk_data") return false;
      if (candidate === `${electronAppState.getPath("userData")}/server-home/.letta/letta.db`) return false;
      return false;
    });
    spawnMock.mockImplementation((_command, args) => {
      const isServerSpawn = Array.isArray(args) && args.includes("from letta.main import app; app()");
      return createChild(isServerSpawn ? undefined : 0);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(process, "resourcesPath", {
      value: originalResourcesPath,
      configurable: true,
    });
  });

  it("records a successful healthcheck and already-running server decision", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });

    const { getDiagnosticSummary, resetDiagnosticsForTests } = await import("./diagnostics.js");
    const trace = { traceId: "trc_server_ok", turnId: "turn_server_ok" };

    try {
      const { ensureBundledLettaServerStarted } = await import("./bundled-letta-server.ts");
      const result = await ensureBundledLettaServerStarted(trace);

      expect(result.status).toBe("already-running");
      expect(spawnMock).not.toHaveBeenCalled();
      expect(getDiagnosticSummary("trc_server_ok")).toMatchObject({
        lastSuccessfulDecisionId: SERVER_ALREADY_RUNNING_001,
        steps: expect.arrayContaining([
          expect.objectContaining({ decisionId: SERVER_RESOLVE_001 }),
          expect.objectContaining({ decisionId: SERVER_HEALTHCHECK_001 }),
        ]),
      });
    } finally {
      resetDiagnosticsForTests();
    }
  });

  it("spawns the bundled server and fails on healthcheck timeout", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 503 });

    const { getDiagnosticSummary, resetDiagnosticsForTests } = await import("./diagnostics.js");
    const trace = { traceId: "trc_server_timeout", turnId: "turn_server_timeout" };

    try {
      const { waitForBundledLettaServerReady } = await import("./bundled-letta-server.ts");
      await expect(waitForBundledLettaServerReady(0, trace)).rejects.toThrow(
        /did not become ready within 0ms/i,
      );

      expect(spawnMock).toHaveBeenCalled();
      expect(getDiagnosticSummary("trc_server_timeout")).toMatchObject({
        errorCode: E_SERVER_HEALTHCHECK_TIMEOUT,
        firstFailedDecisionId: SERVER_HEALTHCHECK_002,
      });
    } finally {
      resetDiagnosticsForTests();
    }
  });

  it("marks the server as exited early when the child quits before ready", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 503 });
    spawnMock.mockImplementation((_command, args) => {
      const isServerSpawn = Array.isArray(args) && args.includes("from letta.main import app; app()");
      return createChild(isServerSpawn ? 1 : 0);
    });

    const { getDiagnosticSummary, resetDiagnosticsForTests } = await import("./diagnostics.js");
    const trace = { traceId: "trc_server_exit", turnId: "turn_server_exit" };

    try {
      const { waitForBundledLettaServerReady } = await import("./bundled-letta-server.ts");
      await expect(waitForBundledLettaServerReady(100, trace)).rejects.toThrow(
        /Bundled Letta server exited/i,
      );

      expect(getDiagnosticSummary("trc_server_exit")).toMatchObject({
        errorCode: E_SERVER_EXITED_EARLY,
        firstFailedDecisionId: SERVER_EXIT_001,
        lastSuccessfulDecisionId: SERVER_START_001,
      });
    } finally {
      resetDiagnosticsForTests();
    }
  });

  it("logs recovery when an already-started child process is reused", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 503 });

    const { getDiagnosticSummary, resetDiagnosticsForTests } = await import("./diagnostics.js");
    const trace = { traceId: "trc_server_recovery", turnId: "turn_server_recovery" };

    try {
      const { ensureBundledLettaServerStarted } = await import("./bundled-letta-server.ts");
      const first = await ensureBundledLettaServerStarted(trace);
      const second = await ensureBundledLettaServerStarted(trace);

      expect(first.status).toBe("starting");
      expect(second.status).toBe("starting");
      expect(getDiagnosticSummary("trc_server_recovery")).toMatchObject({
        lastSuccessfulDecisionId: SERVER_RECOVERY_001,
      });
    } finally {
      resetDiagnosticsForTests();
    }
  });
});
