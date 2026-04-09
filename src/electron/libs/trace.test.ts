import { describe, expect, it, vi } from "vitest";
import {
  createComponentLogger,
  createTraceContext,
  createTraceId,
  createTurnId,
  emitStructuredLog,
} from "./trace.js";

describe("trace foundation", () => {
  it("creates prefixed trace and turn ids", () => {
    expect(createTraceId()).toMatch(/^trc_[0-9a-f]{32}$/);
    expect(createTurnId()).toMatch(/^turn_[0-9a-f]{32}$/);
  });

  it("creates trace context with a generated trace id", () => {
    expect(createTraceContext({ sessionId: "conv-123" })).toMatchObject({
      sessionId: "conv-123",
    });
    expect(createTraceContext().traceId).toMatch(/^trc_[0-9a-f]{32}$/);
  });

  it("emits structured log events through the provided sink", () => {
    const sink = vi.fn();

    const event = emitStructuredLog(
      {
        level: "info",
        component: "ipc",
        trace_id: "trc_testtrace",
        turn_id: "turn_testturn",
        message: "session.start: starting new session",
        data: { cwd: "/tmp/workspace" },
      },
      sink,
    );

    expect(sink).toHaveBeenCalledTimes(1);
    expect(event).toMatchObject({
      level: "info",
      component: "ipc",
      trace_id: "trc_testtrace",
      turn_id: "turn_testturn",
      message: "session.start: starting new session",
      data: { cwd: "/tmp/workspace" },
    });
    expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect("session_id" in event).toBe(false);
  });

  it("creates component loggers that inherit shared trace context", () => {
    const sink = vi.fn();
    const log = createComponentLogger(
      "runner",
      { traceId: "trc_shared", turnId: "turn_shared", sessionId: "conv-7" },
      sink,
    );

    log({
      level: "warn",
      message: "missing conversation id",
      decision_id: "RUNNER-INIT-002",
      error_code: "E_SESSION_CONVERSATION_ID_MISSING",
    });

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runner",
        trace_id: "trc_shared",
        turn_id: "turn_shared",
        session_id: "conv-7",
        decision_id: "RUNNER-INIT-002",
        error_code: "E_SESSION_CONVERSATION_ID_MISSING",
      }),
    );
  });
});
