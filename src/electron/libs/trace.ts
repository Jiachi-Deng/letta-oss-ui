import { randomUUID } from "node:crypto";
import type { DecisionId } from "../../shared/decision-ids.js";
import type { ErrorCode } from "../../shared/error-codes.js";
import { recordDiagnosticEvent } from "./diagnostics.js";

export type TraceLevel = "debug" | "info" | "warn" | "error";

export type TraceComponent =
  | "ipc"
  | "runner"
  | "provider-bootstrap"
  | "letta-code-cli"
  | "bundled-codeisland"
  | "bundled-letta-server"
  | "main-runtime"
  | "ui"
  | (string & {});

export type TraceContext = {
  traceId: string;
  turnId?: string;
  sessionId?: string;
};

export type StructuredLogEvent = {
  ts: string;
  level: TraceLevel;
  component: TraceComponent;
  trace_id: string;
  turn_id?: string;
  session_id?: string;
  decision_id?: DecisionId;
  error_code?: ErrorCode;
  message: string;
  data?: Record<string, unknown>;
};

export type StructuredLogInput = Omit<StructuredLogEvent, "ts"> & {
  ts?: string;
};

export type TraceSink = (event: StructuredLogEvent) => void;
let globalTraceSink: TraceSink = defaultTraceSink;
const traceObservers = new Set<TraceSink>([recordDiagnosticEvent]);

export function createTraceId(): string {
  return `trc_${randomUUID().replaceAll("-", "")}`;
}

export function createTurnId(): string {
  return `turn_${randomUUID().replaceAll("-", "")}`;
}

export function createTraceContext(
  seed: Partial<TraceContext> = {},
): TraceContext {
  return {
    traceId: seed.traceId ?? createTraceId(),
    turnId: seed.turnId,
    sessionId: seed.sessionId,
  };
}

export function extendTraceContext(
  context: TraceContext,
  updates: Partial<Omit<TraceContext, "traceId">>,
): TraceContext {
  return {
    ...context,
    ...updates,
  };
}

export function defaultTraceSink(event: StructuredLogEvent): void {
  if (
    process.env.NODE_ENV === "test"
    || process.env.VITEST === "true"
    || process.env.VITEST === "1"
  ) {
    return;
  }

  const payload = JSON.stringify(event);
  if (event.level === "error") {
    console.error(payload);
    return;
  }
  if (event.level === "warn") {
    console.warn(payload);
    return;
  }
  console.log(payload);
}

export function emitStructuredLog(
  input: StructuredLogInput,
  sink: TraceSink = globalTraceSink,
): StructuredLogEvent {
  const event = stripUndefined({
    ts: input.ts ?? new Date().toISOString(),
    level: input.level,
    component: input.component,
    trace_id: input.trace_id,
    turn_id: input.turn_id,
    session_id: input.session_id,
    decision_id: input.decision_id,
    error_code: input.error_code,
    message: input.message,
    data: input.data,
  });

  sink(event);
  for (const observer of traceObservers) {
    observer(event);
  }
  return event;
}

export function setTraceSink(sink: TraceSink): void {
  globalTraceSink = sink;
}

export function resetTraceSink(): void {
  globalTraceSink = defaultTraceSink;
}

export function addTraceObserver(observer: TraceSink): void {
  traceObservers.add(observer);
}

export function removeTraceObserver(observer: TraceSink): void {
  traceObservers.delete(observer);
}

export function resetTraceObservers(): void {
  traceObservers.clear();
  traceObservers.add(recordDiagnosticEvent);
}

export function createComponentLogger(
  component: TraceComponent,
  baseContext: Partial<TraceContext> = {},
  sink?: TraceSink,
) {
  return (
    input: Omit<StructuredLogInput, "component" | "trace_id" | "turn_id" | "session_id"> &
      Partial<Pick<StructuredLogInput, "trace_id" | "turn_id" | "session_id">>,
  ): StructuredLogEvent =>
    emitStructuredLog(
      {
        ...input,
        component,
        trace_id: input.trace_id ?? baseContext.traceId ?? createTraceId(),
        turn_id: input.turn_id ?? baseContext.turnId,
        session_id: input.session_id ?? baseContext.sessionId,
      },
      sink,
    );
}

function stripUndefined(event: StructuredLogEvent): StructuredLogEvent {
  return Object.fromEntries(
    Object.entries(event).filter(([, value]) => value !== undefined),
  ) as StructuredLogEvent;
}
