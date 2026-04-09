import type { DiagnosticStatus, DiagnosticStep, DiagnosticSummary } from "../../shared/diagnostics.js";
import {
  E_CODEISLAND_LAUNCH_BLOCKED,
  E_CODEISLAND_OS_UNSUPPORTED,
  E_PROVIDER_CONNECT_FAILED,
  E_SESSION_CONVERSATION_ID_MISSING,
  type ErrorCode,
} from "../../shared/error-codes.js";
import type { StructuredLogEvent } from "./trace.js";

type TraceRecord = {
  traceId: string;
  turnId?: string;
  sessionId?: string;
  steps: DiagnosticStep[];
  errorCodes: ErrorCode[];
};

const traces = new Map<string, TraceRecord>();
const latestTraceBySessionId = new Map<string, string>();

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
    return existing;
  }

  const created: TraceRecord = {
    traceId: event.trace_id,
    turnId: event.turn_id,
    sessionId: event.session_id,
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
    case E_CODEISLAND_LAUNCH_BLOCKED:
      return "Open the nested CodeIsland.app once and approve it in System Settings > Privacy & Security, then relaunch Letta.";
    case E_PROVIDER_CONNECT_FAILED:
      return "Inspect the provider base URL, API key, and letta connect CLI stderr for the failed registration step.";
    case E_SESSION_CONVERSATION_ID_MISSING:
      return "Inspect the runner session init boundary to confirm conversation ID assignment after send().";
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
    steps: [...record.steps],
  };
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
  if (event.error_code) {
    record.errorCodes.push(event.error_code);
  }
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

export function listDiagnosticSteps(traceId: string): DiagnosticStep[] {
  return getDiagnosticSummary(traceId)?.steps ?? [];
}

export function resetDiagnosticsForTests(): void {
  traces.clear();
  latestTraceBySessionId.clear();
}
