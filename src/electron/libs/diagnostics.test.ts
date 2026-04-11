import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOT_CONN_001,
  BOOT_CONN_002,
  BOOT_CONN_004,
  CI_BOOT_004,
  IPC_START_001,
  LETTABOT_BACKGROUND_RUN_003,
  LETTABOT_CHANNEL_START_001,
  RC_BOT_ENSURE_003,
  RC_RUNTIME_PREP_003,
  TG_RUNTIME_RELOAD_004,
  TG_RUNTIME_START_003,
  RUNNER_INIT_001,
  RUNNER_INIT_002,
  STREAM_002,
} from "../../shared/decision-ids.js";
import {
  E_CODEISLAND_LAUNCH_BLOCKED,
  E_CODEISLAND_LAUNCH_COMMAND_FAILED,
  E_CODEISLAND_MONITOR_RESTART_FAILED,
  E_LETTA_CLI_EXIT_NON_ZERO,
  E_LETTA_CLI_SPAWN_FAILED,
  E_PROVIDER_CONNECT_FAILED,
  E_PROVIDER_MODEL_NOT_READY,
  E_SESSION_CONVERSATION_ID_MISSING,
  E_HISTORY_LOAD_FAILED,
  E_PERMISSION_RESPONSE_MISSING,
  E_SERVER_EXITED_EARLY,
  E_SERVER_HEALTHCHECK_TIMEOUT,
  E_SERVER_START_FAILED,
  E_SERVER_UNEXPECTED_EXIT,
  E_LETTABOT_BACKGROUND_RUN_FAILED,
  E_LETTABOT_CHANNEL_START_FAILED,
  E_RESIDENT_CORE_BOT_ENSURE_FAILED,
  E_RESIDENT_CORE_RUNTIME_PREP_FAILED,
  E_TELEGRAM_RUNTIME_RELOAD_FAILED,
  E_TELEGRAM_RUNTIME_START_FAILED,
  E_SESSION_STOP_FAILED,
  E_STREAM_EMPTY_RESULT,
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

  it("suggests provider model readiness troubleshooting when bootstrap completes registration before models are synced", () => {
    emitStructuredLog({
      level: "error",
      component: "provider-bootstrap",
      trace_id: "trc_model_ready_wait",
      turn_id: "turn_model_ready_wait",
      session_id: "conv_model_ready_wait",
      decision_id: BOOT_CONN_004,
      error_code: E_PROVIDER_MODEL_NOT_READY,
      message: "compatible provider model readiness check failed",
    });

    expect(getDiagnosticSummary("trc_model_ready_wait")).toMatchObject({
      errorCode: E_PROVIDER_MODEL_NOT_READY,
      firstFailedDecisionId: BOOT_CONN_004,
      suggestedAction:
        "Inspect the compatible provider bootstrap readiness path and confirm the expected model handle is visible from the local Letta server before the first desktop run.",
    });
  });

  it("suggests next steps for newly added phase 1 error codes", () => {
    emitStructuredLog({
      level: "warn",
      component: "ipc",
      trace_id: "trc_history",
      decision_id: "SESSION_HISTORY_003",
      error_code: E_HISTORY_LOAD_FAILED,
      message: "history load failed",
    });
    emitStructuredLog({
      level: "warn",
      component: "ipc",
      trace_id: "trc_permission",
      decision_id: "PERMISSION_RESPONSE_003",
      error_code: E_PERMISSION_RESPONSE_MISSING,
      message: "permission response missing",
    });
    emitStructuredLog({
      level: "warn",
      component: "runner",
      trace_id: "trc_stream",
      decision_id: "STREAM_EMPTY_RESULT_001",
      error_code: E_STREAM_EMPTY_RESULT,
      message: "empty result",
    });
    emitStructuredLog({
      level: "error",
      component: "ipc",
      trace_id: "trc_stop",
      decision_id: "SESSION_STOP_003",
      error_code: E_SESSION_STOP_FAILED,
      message: "session stop failed",
    });

    expect(getDiagnosticSummary("trc_history")).toMatchObject({
      suggestedAction:
        "Inspect the session history cache and projection lookup path for the failing session.",
    });
    expect(getDiagnosticSummary("trc_permission")).toMatchObject({
      suggestedAction:
        "Confirm the permission response matches a live pending toolUseId for the active session.",
    });
    expect(getDiagnosticSummary("trc_stream")).toMatchObject({
      suggestedAction:
        "Inspect the model response and stream translation path for a successful run that produced no assistant text.",
    });
    expect(getDiagnosticSummary("trc_stop")).toMatchObject({
      suggestedAction:
        "Inspect the runner transport abort path and session shutdown cleanup for the active session.",
    });
  });

  it("suggests next steps for bundled server failures", () => {
    emitStructuredLog({
      level: "error",
      component: "bundled-letta-server",
      trace_id: "trc_server_start",
      decision_id: "SERVER_START_002",
      error_code: E_SERVER_START_FAILED,
      message: "server start failed",
    });
    emitStructuredLog({
      level: "error",
      component: "bundled-letta-server",
      trace_id: "trc_server_timeout",
      decision_id: "SERVER_HEALTHCHECK_002",
      error_code: E_SERVER_HEALTHCHECK_TIMEOUT,
      message: "server healthcheck timeout",
    });
    emitStructuredLog({
      level: "error",
      component: "bundled-letta-server",
      trace_id: "trc_server_exit",
      decision_id: "SERVER_EXIT_001",
      error_code: E_SERVER_EXITED_EARLY,
      message: "server exited early",
    });
    emitStructuredLog({
      level: "error",
      component: "bundled-letta-server",
      trace_id: "trc_server_unexpected",
      decision_id: "SERVER_EXIT_002",
      error_code: E_SERVER_UNEXPECTED_EXIT,
      message: "server exited unexpectedly",
    });

    expect(getDiagnosticSummary("trc_server_start")).toMatchObject({
      suggestedAction:
        "Inspect the bundled Letta server runtime path, Python environment, and startup logs.",
    });
    expect(getDiagnosticSummary("trc_server_timeout")).toMatchObject({
      suggestedAction:
        "Inspect the bundled Letta server startup logs and confirm the healthcheck endpoint is reachable on the expected port.",
    });
    expect(getDiagnosticSummary("trc_server_exit")).toMatchObject({
      suggestedAction:
        "Inspect why the bundled Letta server child process exited before healthcheck passed.",
    });
    expect(getDiagnosticSummary("trc_server_unexpected")).toMatchObject({
      suggestedAction:
        "Inspect the bundled Letta server child process for an unexpected exit after it had already been ready.",
    });
  });

  it("suggests next steps for phase 3 subprocess failures", () => {
    emitStructuredLog({
      level: "error",
      component: "letta-code-cli",
      trace_id: "trc_cli_spawn",
      decision_id: "CLI_CONNECT_006",
      error_code: E_LETTA_CLI_SPAWN_FAILED,
      message: "CLI spawn failed",
    });
    emitStructuredLog({
      level: "error",
      component: "letta-code-cli",
      trace_id: "trc_cli_exit",
      decision_id: "CLI_CONNECT_005",
      error_code: E_LETTA_CLI_EXIT_NON_ZERO,
      message: "CLI exited non-zero",
    });
    emitStructuredLog({
      level: "error",
      component: "bundled-codeisland",
      trace_id: "trc_ci_launch_command",
      decision_id: "CI_LAUNCH_003",
      error_code: E_CODEISLAND_LAUNCH_COMMAND_FAILED,
      message: "CodeIsland launch command failed",
    });
    emitStructuredLog({
      level: "error",
      component: "bundled-codeisland",
      trace_id: "trc_ci_monitor",
      decision_id: "CI_MONITOR_004",
      error_code: E_CODEISLAND_MONITOR_RESTART_FAILED,
      message: "CodeIsland monitor restart failed",
    });

    expect(getDiagnosticSummary("trc_cli_spawn")).toMatchObject({
      suggestedAction:
        "Inspect the resolved letta-code CLI path, Node runtime, and spawn environment for the failing registration step.",
    });
    expect(getDiagnosticSummary("trc_cli_exit")).toMatchObject({
      suggestedAction:
        "Inspect the letta connect CLI stderr/stdout summary and confirm the provider arguments were accepted.",
    });
    expect(getDiagnosticSummary("trc_ci_launch_command")).toMatchObject({
      suggestedAction:
        "Inspect the bundled CodeIsland launch command result, quarantine state, and open command stderr.",
    });
    expect(getDiagnosticSummary("trc_ci_monitor")).toMatchObject({
      suggestedAction:
        "Inspect the CodeIsland monitor restart path and the preceding launch command result.",
    });
  });

  it("suggests next steps for lettabot channel-layer failures", () => {
    emitStructuredLog({
      level: "error",
      component: "lettabot-bot",
      trace_id: "trc_lettabot_channel",
      decision_id: LETTABOT_CHANNEL_START_001,
      error_code: E_LETTABOT_CHANNEL_START_FAILED,
      message: "channel startup failed",
    });
    emitStructuredLog({
      level: "error",
      component: "lettabot-bot",
      trace_id: "trc_lettabot_bg",
      decision_id: LETTABOT_BACKGROUND_RUN_003,
      error_code: E_LETTABOT_BACKGROUND_RUN_FAILED,
      message: "background run failed",
    });

    expect(getDiagnosticSummary("trc_lettabot_channel")).toMatchObject({
      suggestedAction:
        "Inspect the failing LettaBot channel adapter startup and the adapter-specific credentials or network path.",
    });
    expect(getDiagnosticSummary("trc_lettabot_bg")).toMatchObject({
      suggestedAction:
        "Inspect the heartbeat/cron/background trigger path and the corresponding LettaBot session run trace.",
    });
  });

  it("suggests next steps for Resident Core boundary failures", () => {
    emitStructuredLog({
      level: "error",
      component: "resident-core-runtime-host",
      trace_id: "trc_rc_runtime",
      decision_id: RC_RUNTIME_PREP_003,
      error_code: E_RESIDENT_CORE_RUNTIME_PREP_FAILED,
      message: "runtime prep failed",
    });
    emitStructuredLog({
      level: "error",
      component: "resident-core-session-owner",
      trace_id: "trc_rc_ensure",
      decision_id: RC_BOT_ENSURE_003,
      error_code: E_RESIDENT_CORE_BOT_ENSURE_FAILED,
      message: "ensure bot session failed",
    });

    expect(getDiagnosticSummary("trc_rc_runtime")).toMatchObject({
      suggestedAction:
        "Inspect the Resident Core runtime host, app config state, and provider bootstrap path before session creation.",
    });
    expect(getDiagnosticSummary("trc_rc_ensure")).toMatchObject({
      suggestedAction:
        "Inspect the Resident Core bot ensure-session path and why a reusable session could not be initialized or resumed.",
    });
  });

  it("suggests next steps for Telegram runtime lifecycle failures", () => {
    emitStructuredLog({
      level: "error",
      component: "main",
      trace_id: "trc_tg_reload",
      decision_id: TG_RUNTIME_RELOAD_004,
      error_code: E_TELEGRAM_RUNTIME_RELOAD_FAILED,
      message: "telegram runtime reload failed",
    });
    emitStructuredLog({
      level: "error",
      component: "main-runtime",
      trace_id: "trc_tg_start",
      decision_id: TG_RUNTIME_START_003,
      error_code: E_TELEGRAM_RUNTIME_START_FAILED,
      message: "telegram runtime start failed",
    });

    expect(getDiagnosticSummary("trc_tg_reload")).toMatchObject({
      suggestedAction:
        "Inspect the save-app-config hot reload path, previous LettaBot host shutdown, and the next Telegram runtime bundle startup.",
    });
    expect(getDiagnosticSummary("trc_tg_start")).toMatchObject({
      suggestedAction:
        "Inspect the Telegram runtime startup path during app boot, including runtime config, host creation, and adapter startup.",
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
