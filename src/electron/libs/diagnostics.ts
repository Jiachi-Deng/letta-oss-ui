import type {
  DiagnosticStatus,
  DiagnosticStep,
  DiagnosticSummary,
  DiagnosticSummaryListItem,
} from "../../shared/diagnostics.js";
import {
  E_CODEISLAND_LAUNCH_COMMAND_FAILED,
  E_CODEISLAND_LAUNCH_BLOCKED,
  E_CODEISLAND_OS_UNSUPPORTED,
  E_HISTORY_LOAD_FAILED,
  E_CODEISLAND_MONITOR_RESTART_FAILED,
  E_LETTA_CLI_EXIT_NON_ZERO,
  E_LETTA_CLI_SPAWN_FAILED,
  E_PERMISSION_RESPONSE_MISSING,
  E_PROVIDER_CONNECT_FAILED,
  E_SESSION_CONVERSATION_ID_MISSING,
  E_SESSION_STOP_FAILED,
  E_SERVER_EXITED_EARLY,
  E_SERVER_HEALTHCHECK_TIMEOUT,
  E_SERVER_START_FAILED,
  E_SERVER_UNEXPECTED_EXIT,
  E_STREAM_EMPTY_RESULT,
  type ErrorCode,
} from "../../shared/error-codes.js";
import type { StructuredLogEvent } from "./trace.js";
import {
  MAX_STORED_DIAGNOSTIC_TRACES,
  readPersistedDiagnosticSummaries,
  writePersistedDiagnosticSummaries,
} from "./diagnostics-storage.js";

type TraceRecord = {
  traceId: string;
  turnId?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  steps: DiagnosticStep[];
  errorCodes: ErrorCode[];
};

type DiagnosticsPersistenceState = {
  userDataPath: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
};

const traces = new Map<string, TraceRecord>();
const latestTraceBySessionId = new Map<string, string>();
let persistenceState: DiagnosticsPersistenceState | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function cloneStep(step: DiagnosticStep): DiagnosticStep {
  return {
    ...step,
    data: step.data ? { ...step.data } : undefined,
  };
}

function getOrCreateTraceRecord(event: StructuredLogEvent): TraceRecord {
  const existing = traces.get(event.trace_id);
  if (existing) {
    if (event.turn_id) {
      existing.turnId = event.turn_id;
    }
    if (event.session_id) {
      existing.sessionId = event.session_id;
      latestTraceBySessionId.set(event.session_id, event.trace_id);
    }
    if (event.ts > existing.updatedAt) {
      existing.updatedAt = event.ts;
    }
    return existing;
  }

  const created: TraceRecord = {
    traceId: event.trace_id,
    turnId: event.turn_id,
    sessionId: event.session_id,
    createdAt: event.ts,
    updatedAt: event.ts,
    steps: [],
    errorCodes: [],
  };

  if (event.session_id) {
    latestTraceBySessionId.set(event.session_id, event.trace_id);
  }

  traces.set(event.trace_id, created);
  return created;
}

function getStepStatus(event: StructuredLogEvent): DiagnosticStatus {
  if (event.level === "error" || event.error_code) {
    return "error";
  }
  if (event.level === "warn") {
    return "warning";
  }
  return "ok";
}

function getDominantErrorCode(errorCodes: ErrorCode[]): ErrorCode | undefined {
  if (errorCodes.length === 0) return undefined;

  const frequency = new Map<ErrorCode, { count: number; firstIndex: number }>();
  for (const [index, code] of errorCodes.entries()) {
    const current = frequency.get(code);
    if (current) {
      current.count += 1;
      continue;
    }
    frequency.set(code, { count: 1, firstIndex: index });
  }

  return [...frequency.entries()]
    .sort((left, right) => {
      const [, leftMeta] = left;
      const [, rightMeta] = right;
      if (leftMeta.count !== rightMeta.count) {
        return rightMeta.count - leftMeta.count;
      }
      return leftMeta.firstIndex - rightMeta.firstIndex;
    })[0]?.[0];
}

function getSuggestedAction(errorCode?: ErrorCode): string | undefined {
  switch (errorCode) {
    case E_CODEISLAND_OS_UNSUPPORTED:
      return "Update the machine to macOS 14 or later to enable CodeIsland.";
    case E_CODEISLAND_LAUNCH_COMMAND_FAILED:
      return "Inspect the bundled CodeIsland launch command result, quarantine state, and open command stderr.";
    case E_CODEISLAND_LAUNCH_BLOCKED:
      return "Open the nested CodeIsland.app once and approve it in System Settings > Privacy & Security, then relaunch Letta.";
    case E_CODEISLAND_MONITOR_RESTART_FAILED:
      return "Inspect the CodeIsland monitor restart path and the preceding launch command result.";
    case E_PROVIDER_CONNECT_FAILED:
      return "Inspect the provider base URL, API key, and letta connect CLI stderr for the failed registration step.";
    case E_LETTA_CLI_SPAWN_FAILED:
      return "Inspect the resolved letta-code CLI path, Node runtime, and spawn environment for the failing registration step.";
    case E_LETTA_CLI_EXIT_NON_ZERO:
      return "Inspect the letta connect CLI stderr/stdout summary and confirm the provider arguments were accepted.";
    case E_SESSION_CONVERSATION_ID_MISSING:
      return "Inspect the runner session init boundary to confirm conversation ID assignment after send().";
    case E_HISTORY_LOAD_FAILED:
      return "Inspect the session history cache and projection lookup path for the failing session.";
    case E_PERMISSION_RESPONSE_MISSING:
      return "Confirm the permission response matches a live pending toolUseId for the active session.";
    case E_STREAM_EMPTY_RESULT:
      return "Inspect the model response and stream translation path for a successful run that produced no assistant text.";
    case E_SESSION_STOP_FAILED:
      return "Inspect the runner transport abort path and session shutdown cleanup for the active session.";
    case E_SERVER_START_FAILED:
      return "Inspect the bundled Letta server runtime path, Python environment, and startup logs.";
    case E_SERVER_HEALTHCHECK_TIMEOUT:
      return "Inspect the bundled Letta server startup logs and confirm the healthcheck endpoint is reachable on the expected port.";
    case E_SERVER_EXITED_EARLY:
      return "Inspect why the bundled Letta server child process exited before healthcheck passed.";
    case E_SERVER_UNEXPECTED_EXIT:
      return "Inspect the bundled Letta server child process for an unexpected exit after it had already been ready.";
    default:
      return undefined;
  }
}

function buildSummary(record: TraceRecord): DiagnosticSummary {
  const firstFailedStep = record.steps.find(
    (step) => step.status === "error" && step.decisionId,
  );
  const lastSuccessfulStep = [...record.steps]
    .reverse()
    .find((step) => step.status === "ok" && step.decisionId);
  const dominantErrorCode = getDominantErrorCode(record.errorCodes);

  const summary =
    firstFailedStep
      ? `Trace failed at ${firstFailedStep.decisionId} after ${lastSuccessfulStep?.decisionId ?? "no prior successful decision"}.`
      : `Trace completed without a recorded failure. Last successful decision: ${lastSuccessfulStep?.decisionId ?? "unknown"}.`;

  return {
    traceId: record.traceId,
    turnId: record.turnId,
    sessionId: record.sessionId,
    summary,
    errorCode: dominantErrorCode,
    lastSuccessfulDecisionId: lastSuccessfulStep?.decisionId,
    firstFailedDecisionId: firstFailedStep?.decisionId,
    suggestedAction: getSuggestedAction(dominantErrorCode),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    stepCount: record.steps.length,
    steps: record.steps.map(cloneStep),
  };
}

function toTraceRecord(summary: DiagnosticSummary): TraceRecord {
  const createdAt = summary.createdAt ?? summary.updatedAt ?? nowIso();
  const updatedAt = summary.updatedAt ?? summary.createdAt ?? createdAt;
  const errorCodes = new Set<ErrorCode>();

  if (summary.errorCode) {
    errorCodes.add(summary.errorCode);
  }

  for (const step of summary.steps) {
    if (step.errorCode) {
      errorCodes.add(step.errorCode);
    }
  }

  return {
    traceId: summary.traceId,
    turnId: summary.turnId,
    sessionId: summary.sessionId,
    createdAt,
    updatedAt,
    steps: summary.steps.map(cloneStep),
    errorCodes: [...errorCodes],
  };
}

function trimTraceRecords(): void {
  if (traces.size <= MAX_STORED_DIAGNOSTIC_TRACES) {
    return;
  }

  const keepTraceIds = new Set(
    [...traces.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_STORED_DIAGNOSTIC_TRACES)
      .map((record) => record.traceId),
  );

  for (const traceId of traces.keys()) {
    if (!keepTraceIds.has(traceId)) {
      traces.delete(traceId);
    }
  }

  rebuildLatestTraceBySessionId();
}

function rebuildLatestTraceBySessionId(): void {
  latestTraceBySessionId.clear();

  const records = [...traces.values()].sort((left, right) => {
    const updatedComparison = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedComparison !== 0) return updatedComparison;
    return right.createdAt.localeCompare(left.createdAt);
  });

  for (const record of records) {
    if (!record.sessionId) continue;
    if (!latestTraceBySessionId.has(record.sessionId)) {
      latestTraceBySessionId.set(record.sessionId, record.traceId);
    }
  }
}

function persistDiagnosticsSnapshot(): void {
  if (!persistenceState) {
    return;
  }

  const summaries = getPersistableDiagnosticSummaries();
  writePersistedDiagnosticSummaries(persistenceState.userDataPath, summaries);
}

function getPersistableDiagnosticSummaries(): DiagnosticSummary[] {
  return [...traces.values()]
    .sort((left, right) => {
      const updatedComparison = right.updatedAt.localeCompare(left.updatedAt);
      if (updatedComparison !== 0) return updatedComparison;
      return right.createdAt.localeCompare(left.createdAt);
    })
    .map((record) => buildSummary(record));
}

function scheduleDiagnosticsPersistence(): void {
  if (!persistenceState) {
    return;
  }

  if (persistenceState.flushTimer) {
    return;
  }

  persistenceState.flushTimer = setTimeout(() => {
    if (persistenceState) {
      persistenceState.flushTimer = null;
      persistDiagnosticsSnapshot();
    }
  }, 100);

  persistenceState.flushTimer.unref?.();
}

export function initializeDiagnosticsPersistence(userDataPath: string): void {
  if (persistenceState?.flushTimer) {
    clearTimeout(persistenceState.flushTimer);
  }

  persistenceState = {
    userDataPath,
    flushTimer: null,
  };

  traces.clear();
  latestTraceBySessionId.clear();

  const persistedSummaries = readPersistedDiagnosticSummaries(userDataPath);
  for (const summary of persistedSummaries) {
    traces.set(summary.traceId, toTraceRecord(summary));
  }

  trimTraceRecords();
  rebuildLatestTraceBySessionId();
}

export function recordDiagnosticEvent(event: StructuredLogEvent): void {
  const record = getOrCreateTraceRecord(event);
  const step: DiagnosticStep = {
    component: event.component,
    decisionId: event.decision_id,
    status: getStepStatus(event),
    message: event.message,
    errorCode: event.error_code,
    data: event.data,
  };

  record.steps.push(step);
  record.updatedAt = event.ts;
  if (event.error_code) {
    record.errorCodes.push(event.error_code);
  }

  trimTraceRecords();
  scheduleDiagnosticsPersistence();
}

export function getDiagnosticSummary(traceId: string): DiagnosticSummary | null {
  const record = traces.get(traceId);
  return record ? buildSummary(record) : null;
}

export function getLatestDiagnosticSummaryForSession(
  sessionId: string,
): DiagnosticSummary | null {
  const traceId = latestTraceBySessionId.get(sessionId);
  return traceId ? getDiagnosticSummary(traceId) : null;
}

export function listDiagnosticSummaries(): DiagnosticSummaryListItem[] {
  return getPersistableDiagnosticSummaries().map((summary) => {
    const { steps: _steps, ...listItem } = summary;
    return listItem;
  });
}

export function listDiagnosticSteps(traceId: string): DiagnosticStep[] {
  return getDiagnosticSummary(traceId)?.steps ?? [];
}

export function flushDiagnosticsPersistence(): void {
  if (!persistenceState) return;
  if (persistenceState.flushTimer) {
    clearTimeout(persistenceState.flushTimer);
    persistenceState.flushTimer = null;
  }
  persistDiagnosticsSnapshot();
}

export function resetDiagnosticsForTests(): void {
  if (persistenceState?.flushTimer) {
    clearTimeout(persistenceState.flushTimer);
  }

  traces.clear();
  latestTraceBySessionId.clear();
  persistenceState = null;
}
