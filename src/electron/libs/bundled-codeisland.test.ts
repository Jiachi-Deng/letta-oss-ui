import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CI_BOOT_001,
  CI_BOOT_002,
  CI_BOOT_003,
  CI_BOOT_004,
  CI_LAUNCH_001,
  CI_LAUNCH_002,
  CI_LAUNCH_003,
} from "../../shared/decision-ids.js";
import {
  E_CODEISLAND_BUNDLE_MISSING,
  E_CODEISLAND_LAUNCH_BLOCKED,
  E_CODEISLAND_LAUNCH_COMMAND_FAILED,
  E_CODEISLAND_OS_UNSUPPORTED,
} from "../../shared/error-codes.js";

const spawnSyncMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn<(path: string) => boolean>());
const electronAppState = vi.hoisted(() => ({
  isPackaged: true,
  getAppPath: () => "/Applications/Letta.app/Contents/Resources/app.asar",
}));

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
}));

vi.mock("electron", () => ({
  default: {
    app: electronAppState,
  },
  app: electronAppState,
}));

describe("bundled CodeIsland observability", () => {
  const originalResourcesPath = process.resourcesPath;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(process, "resourcesPath", {
      value: "/Applications/Letta.app/Contents/Resources",
      configurable: true,
    });
    vi.spyOn(Atomics, "wait").mockImplementation(() => "ok");
  });

  afterEach(async () => {
    const trace = await import("./trace.ts");
    trace.resetTraceSink();
    Object.defineProperty(process, "resourcesPath", {
      value: originalResourcesPath,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("emits an unsupported platform decision with a stable error code", async () => {
    const events: Array<Record<string, unknown>> = [];
    const trace = await import("./trace.ts");
    trace.setTraceSink((event) => {
      events.push(event as unknown as Record<string, unknown>);
    });
    const { ensureCodeIslandStarted } = await import("./bundled-codeisland.ts");

    const result = ensureCodeIslandStarted(
      {
        appPath: "/Applications/Letta.app/Contents/Resources/app.asar",
        cwd: "/tmp",
        isPackaged: true,
        platform: "darwin",
        resourcesPath: "/Applications/Letta.app/Contents/Resources",
        systemVersion: "13.6.1",
      },
      { trace: { traceId: "trc_ci_old", turnId: "turn_ci_old" } },
    );

    expect(result).toEqual({ status: "unsupported" });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "bundled-codeisland",
          trace_id: "trc_ci_old",
          turn_id: "turn_ci_old",
          decision_id: CI_BOOT_002,
          error_code: E_CODEISLAND_OS_UNSUPPORTED,
        }),
      ]),
    );
  });

  it("emits a missing bundle decision with a stable error code", async () => {
    existsSyncMock.mockReturnValue(false);
    const events: Array<Record<string, unknown>> = [];
    const trace = await import("./trace.ts");
    trace.setTraceSink((event) => {
      events.push(event as unknown as Record<string, unknown>);
    });
    const { ensureCodeIslandStarted } = await import("./bundled-codeisland.ts");

    const result = ensureCodeIslandStarted(
      {
        appPath: "/Applications/Letta.app/Contents/Resources/app.asar",
        cwd: "/tmp",
        isPackaged: true,
        platform: "darwin",
        resourcesPath: "/Applications/Letta.app/Contents/Resources",
        systemVersion: "14.5.0",
      },
      { trace: { traceId: "trc_ci_missing", turnId: "turn_ci_missing" } },
    );

    expect(result).toEqual({ status: "missing" });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "bundled-codeisland",
          trace_id: "trc_ci_missing",
          turn_id: "turn_ci_missing",
          decision_id: CI_BOOT_001,
          error_code: E_CODEISLAND_BUNDLE_MISSING,
        }),
      ]),
    );
  });

  it("emits launch and verify failures with stable decision ids", async () => {
    existsSyncMock.mockReturnValue(true);
    spawnSyncMock.mockImplementation((command: string) => {
      if (command === "pgrep") {
        return { status: 1 };
      }
      if (command === "open") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "xattr") {
        return { status: 1, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "" };
    });
    const events: Array<Record<string, unknown>> = [];
    const trace = await import("./trace.ts");
    trace.setTraceSink((event) => {
      events.push(event as unknown as Record<string, unknown>);
    });
    const { ensureCodeIslandStarted } = await import("./bundled-codeisland.ts");

    const result = ensureCodeIslandStarted(
      {
        appPath: "/Applications/Letta.app/Contents/Resources/app.asar",
        cwd: "/tmp",
        isPackaged: true,
        platform: "darwin",
        resourcesPath: "/Applications/Letta.app/Contents/Resources",
        systemVersion: "14.5.0",
      },
      { trace: { traceId: "trc_ci_launch", turnId: "turn_ci_launch" } },
    );

    expect(result.status).toBe("failed");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "bundled-codeisland",
          trace_id: "trc_ci_launch",
          turn_id: "turn_ci_launch",
          decision_id: CI_BOOT_003,
        }),
        expect.objectContaining({
          component: "bundled-codeisland",
          trace_id: "trc_ci_launch",
          turn_id: "turn_ci_launch",
          decision_id: CI_LAUNCH_001,
        }),
        expect.objectContaining({
          component: "bundled-codeisland",
          trace_id: "trc_ci_launch",
          turn_id: "turn_ci_launch",
          decision_id: CI_LAUNCH_002,
        }),
        expect.objectContaining({
          component: "bundled-codeisland",
          trace_id: "trc_ci_launch",
          turn_id: "turn_ci_launch",
          decision_id: CI_BOOT_004,
          error_code: E_CODEISLAND_LAUNCH_BLOCKED,
        }),
      ]),
    );
  });

  it("emits a launch command failure with a stable error code", async () => {
    existsSyncMock.mockReturnValue(true);
    spawnSyncMock.mockImplementation((command: string) => {
      if (command === "pgrep") {
        return { status: 1 };
      }
      if (command === "open") {
        return {
          status: 1,
          stdout: "",
          stderr: "open failed",
        };
      }
      if (command === "xattr") {
        return { status: 1, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "" };
    });
    const events: Array<Record<string, unknown>> = [];
    const trace = await import("./trace.ts");
    trace.setTraceSink((event) => {
      events.push(event as unknown as Record<string, unknown>);
    });
    const { ensureCodeIslandStarted } = await import("./bundled-codeisland.ts");

    const result = ensureCodeIslandStarted(
      {
        appPath: "/Applications/Letta.app/Contents/Resources/app.asar",
        cwd: "/tmp",
        isPackaged: true,
        platform: "darwin",
        resourcesPath: "/Applications/Letta.app/Contents/Resources",
        systemVersion: "14.5.0",
      },
      { trace: { traceId: "trc_ci_launch_fail", turnId: "turn_ci_launch_fail" } },
    );

    expect(result.status).toBe("failed");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "bundled-codeisland",
          trace_id: "trc_ci_launch_fail",
          turn_id: "turn_ci_launch_fail",
          decision_id: CI_LAUNCH_001,
        }),
        expect.objectContaining({
          component: "bundled-codeisland",
          trace_id: "trc_ci_launch_fail",
          turn_id: "turn_ci_launch_fail",
          decision_id: CI_LAUNCH_002,
        }),
        expect.objectContaining({
          component: "bundled-codeisland",
          trace_id: "trc_ci_launch_fail",
          turn_id: "turn_ci_launch_fail",
          decision_id: CI_LAUNCH_003,
          error_code: E_CODEISLAND_LAUNCH_COMMAND_FAILED,
        }),
      ]),
    );
  });

  it("resolves the development CodeIsland app from the workspace vendor build output", async () => {
    const workspaceAppPath = "/Users/jachi/Desktop/letta-workspace/app/letta-desktop";
    const workspaceCwd = "/Users/jachi/Desktop/letta-workspace/app/letta-desktop";
    const expectedPath =
      "/Users/jachi/Desktop/letta-workspace/vendor/code-island/.build/arm64-apple-macosx/release/CodeIsland.app";

    existsSyncMock.mockImplementation((candidatePath: string) => candidatePath === expectedPath);

    const { resolveCodeIslandApp } = await import("./bundled-codeisland.ts");

    expect(
      resolveCodeIslandApp({
        appPath: workspaceAppPath,
        cwd: workspaceCwd,
        isPackaged: false,
        platform: "darwin",
        resourcesPath: "/Applications/Letta.app/Contents/Resources",
        systemVersion: "14.5.0",
      }),
    ).toEqual({
      appPath: expectedPath,
      source: "dev-build",
    });
  });
});
