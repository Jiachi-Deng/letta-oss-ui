import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOT_CONN_001,
  BOOT_CONN_002,
  CI_BOOT_004,
  IPC_START_001,
  RUNNER_INIT_001,
  RUNNER_INIT_002,
  STREAM_002,
} from "../../shared/decision-ids.js";
import {
  E_CODEISLAND_LAUNCH_BLOCKED,
  E_PROVIDER_CONNECT_FAILED,
  E_SESSION_CONVERSATION_ID_MISSING,
} from "../../shared/error-codes.js";
import {
  getDiagnosticSummary,
  getLatestDiagnosticSummaryForSession,
  listDiagnosticSteps,
  resetDiagnosticsForTests,
} from "./diagnostics.js";
import {
  emitStructuredLog,
  resetTraceObservers,
  resetTraceSink,
  setTraceSink,
} from "./trace.js";

describe("diagnostics aggregation", () => {
  beforeEach(() => {
    resetDiagnosticsForTests();
    resetTraceSink();
    resetTraceObservers();
  });

  it("builds a success summary for an all-success trace", () => {
    emitStructuredLog({
      level: "info",
      component: "ipc",
      trace_id: "trc_success",
      turn_id: "turn_success",
      session_id: "conv_success",
      decision_id: IPC_START_001,
      message: "session.start entered",
    });
    emitStructuredLog({
      level: "info",
      component: "runner",
      trace_id: "trc_success",
      turn_id: "turn_success",
      session_id: "conv_success",
      decision_id: STREAM_002,
      message: "stream completed successfully",
    });

    expect(getDiagnosticSummary("trc_success")).toMatchObject({
      traceId: "trc_success",
      turnId: "turn_success",
      sessionId: "conv_success",
      errorCode: undefined,
      firstFailedDecisionId: undefined,
      lastSuccessfulDecisionId: STREAM_002,
    });
  });

  it("identifies the first failed decision after earlier successes", () => {
    emitStructuredLog({
      level: "info",
      component: "ipc",
      trace_id: "trc_failure",
      turn_id: "turn_failure",
      session_id: "conv_failure",
      decision_id: IPC_START_001,
      message: "session.start entered",
    });
    emitStructuredLog({
      level: "info",
      component: "runner",
      trace_id: "trc_failure",
      turn_id: "turn_failure",
      session_id: "conv_failure",
      decision_id: RUNNER_INIT_001,
      message: "runner initialized",
    });
    emitStructuredLog({
      level: "error",
      component: "provider-bootstrap",
      trace_id: "trc_failure",
      turn_id: "turn_failure",
      session_id: "conv_failure",
      decision_id: BOOT_CONN_002,
      error_code: E_PROVIDER_CONNECT_FAILED,
      message: "provider bootstrap failed",
    });

    expect(getDiagnosticSummary("trc_failure")).toMatchObject({
      lastSuccessfulDecisionId: RUNNER_INIT_001,
      firstFailedDecisionId: BOOT_CONN_002,
      errorCode: E_PROVIDER_CONNECT_FAILED,
      suggestedAction:
        "Inspect the provider base URL, API key, and letta connect CLI stderr for the failed registration step.",
    });
  });

  it("maps known error codes to deterministic suggested actions", () => {
    emitStructuredLog({
      level: "warn",
      component: "bundled-codeisland",
      trace_id: "trc_ci",
      turn_id: "turn_ci",
      session_id: "conv_ci",
      decision_id: CI_BOOT_004,
      error_code: E_CODEISLAND_LAUNCH_BLOCKED,
      message: "CodeIsland failed launch verification",
    });

    expect(getDiagnosticSummary("trc_ci")).toMatchObject({
      errorCode: E_CODEISLAND_LAUNCH_BLOCKED,
      firstFailedDecisionId: CI_BOOT_004,
      suggestedAction:
        "Open the nested CodeIsland.app once and approve it in System Settings > Privacy & Security, then relaunch Letta.",
    });
  });

  it("returns the latest diagnostic summary for a session", () => {
    emitStructuredLog({
      level: "info",
      component: "runner",
      trace_id: "trc_old",
      turn_id: "turn_old",
      session_id: "conv_shared",
      decision_id: RUNNER_INIT_001,
      message: "older trace",
    });
    emitStructuredLog({
      level: "warn",
      component: "runner",
      trace_id: "trc_new",
      turn_id: "turn_new",
      session_id: "conv_shared",
      decision_id: RUNNER_INIT_002,
      error_code: E_SESSION_CONVERSATION_ID_MISSING,
      message: "newer trace",
    });

    expect(getLatestDiagnosticSummaryForSession("conv_shared")).toMatchObject({
      traceId: "trc_new",
      errorCode: E_SESSION_CONVERSATION_ID_MISSING,
    });
  });

  it("resets stored diagnostics for tests", () => {
    emitStructuredLog({
      level: "info",
      component: "runner",
      trace_id: "trc_reset",
      decision_id: RUNNER_INIT_001,
      message: "before reset",
    });

    expect(listDiagnosticSteps("trc_reset")).toHaveLength(1);
    resetDiagnosticsForTests();
    expect(getDiagnosticSummary("trc_reset")).toBeNull();
    expect(listDiagnosticSteps("trc_reset")).toEqual([]);
  });

  it("keeps diagnostics aggregation active when a custom trace sink is installed", () => {
    const sink = vi.fn();
    setTraceSink(sink);

    emitStructuredLog({
      level: "info",
      component: "provider-bootstrap",
      trace_id: "trc_sink",
      turn_id: "turn_sink",
      session_id: "conv_sink",
      decision_id: BOOT_CONN_001,
      message: "bootstrap begin",
    });

    expect(sink).toHaveBeenCalledTimes(1);
    expect(getDiagnosticSummary("trc_sink")).toMatchObject({
      traceId: "trc_sink",
      lastSuccessfulDecisionId: BOOT_CONN_001,
    });
  });
});
