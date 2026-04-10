import type { ClientEvent, ServerEvent } from "../../types.js";
import { runLetta, type RunnerHandle } from "../runner.js";
import {
  clearCodeIslandObservation,
  finishCodeIslandObservation,
} from "../codeisland-observer.js";
import { discardAllReusableConversationSessions, discardReusableConversationSession, isConversationTurnActive } from "../conversation-session-cache.js";
import { createComponentLogger, createTraceContext, createTurnId, type TraceContext } from "../trace.js";
import type { PendingPermission } from "../runtime-state.js";
import { createResidentCoreRunnerRegistry } from "./runner-registry.js";
import { createResidentCoreSessionStore } from "./session-store.js";
import type { ResidentCoreSessionOwner } from "./session-owner.js";
import {
  IPC_CONTINUE_001,
  IPC_START_001,
  PERMISSION_RESPONSE_001,
  PERMISSION_RESPONSE_002,
  PERMISSION_RESPONSE_003,
  SESSION_DELETE_001,
  SESSION_DELETE_002,
  SESSION_DELETE_003,
  SESSION_HISTORY_001,
  SESSION_HISTORY_002,
  SESSION_HISTORY_003,
  SESSION_STOP_001,
  SESSION_STOP_002,
  SESSION_STOP_003,
} from "../../../shared/decision-ids.js";
import {
  E_HISTORY_LOAD_FAILED,
  E_PERMISSION_RESPONSE_MISSING,
  E_SESSION_STOP_FAILED,
} from "../../../shared/error-codes.js";

const DEBUG = process.env.DEBUG_IPC === "true";
const residentCoreLog = createComponentLogger("resident-core");

export type ResidentCoreBroadcast = (event: ServerEvent) => void;

function log(msg: string, data?: Record<string, unknown>, context?: TraceContext): void {
  residentCoreLog({
    level: "info",
    message: msg,
    data,
    trace_id: context?.traceId,
    turn_id: context?.turnId,
    session_id: context?.sessionId,
  });
}

function debug(msg: string, data?: Record<string, unknown>, context?: TraceContext): void {
  if (!DEBUG) return;
  residentCoreLog({
    level: "debug",
    message: msg,
    data,
    trace_id: context?.traceId,
    turn_id: context?.turnId,
    session_id: context?.sessionId,
  });
}

function createSessionTraceContext(conversationId: string): TraceContext {
  return createTraceContext({
    turnId: createTurnId(),
    sessionId: conversationId,
  });
}

function remapEventSessionId(event: ServerEvent, sessionId: string): ServerEvent {
  if (!("payload" in event) || !event.payload || typeof (event.payload as { sessionId?: unknown }).sessionId !== "string") {
    return event;
  }

  return {
    ...event,
    payload: {
      ...event.payload,
      sessionId,
    },
  } as ServerEvent;
}

export class ResidentCoreService {
  private readonly runnerRegistry = createResidentCoreRunnerRegistry();
  private readonly sessionStore = createResidentCoreSessionStore();

  constructor(
    private readonly broadcast: ResidentCoreBroadcast,
    private readonly sessionOwner: ResidentCoreSessionOwner,
  ) {}

  private emit(event: ServerEvent): void {
    if (event.type === "session.status") {
      const existing = this.sessionStore.get(event.payload.sessionId);
      if (existing) {
        this.sessionStore.update(event.payload.sessionId, {
          status: event.payload.status,
          title: event.payload.title ?? existing.title,
          cwd: event.payload.cwd ?? existing.cwd,
          error: event.payload.error,
        });
      } else if (event.payload.sessionId !== "pending") {
        this.sessionStore.ensure(event.payload.sessionId, {
          status: event.payload.status,
          title: event.payload.title ?? event.payload.sessionId,
          cwd: event.payload.cwd,
          error: event.payload.error,
        });
      }

      if (event.payload.status === "completed" || event.payload.status === "error") {
        this.runnerRegistry.delete(event.payload.sessionId);
      }
    }

    if (event.type === "stream.user_prompt") {
      this.sessionStore.appendUserPrompt(event.payload.sessionId, event.payload.prompt);
    }

    if (event.type === "stream.message") {
      this.sessionStore.appendMessage(event.payload.sessionId, event.payload.message);
    }

    this.broadcast(event);
  }

  private async handleSessionList(): Promise<void> {
    this.emit({ type: "session.list", payload: { sessions: this.sessionStore.list() } });
  }

  private async handleSessionHistory(conversationId: string): Promise<void> {
    const traceContext = createSessionTraceContext(conversationId);

    residentCoreLog({
      level: "info",
      message: "session.history: boundary entered",
      decision_id: SESSION_HISTORY_001,
      trace_id: traceContext.traceId,
      turn_id: traceContext.turnId,
      session_id: traceContext.sessionId,
      data: { sessionId: conversationId },
    });

    try {
      const session = this.sessionStore.get(conversationId);
      const messages = this.sessionStore.history(conversationId);

      residentCoreLog({
        level: "info",
        message: "session.history: history loaded",
        decision_id: SESSION_HISTORY_002,
        trace_id: traceContext.traceId,
        turn_id: traceContext.turnId,
        session_id: traceContext.sessionId,
        data: {
          sessionStatus: session?.status ?? "idle",
          messageCount: messages.length,
        },
      });

      this.emit({
        type: "session.history",
        payload: {
          sessionId: conversationId,
          status: session?.status ?? "idle",
          messages,
        },
      });
    } catch (error) {
      residentCoreLog({
        level: "error",
        message: "session.history: failed to load history",
        decision_id: SESSION_HISTORY_003,
        error_code: E_HISTORY_LOAD_FAILED,
        trace_id: traceContext.traceId,
        turn_id: traceContext.turnId,
        session_id: traceContext.sessionId,
        data: {
          error: String(error),
        },
      });
      this.emit({
        type: "runner.error",
        payload: {
          sessionId: conversationId,
          traceId: traceContext.traceId,
          message: String(error),
        },
      });
    }
  }

  private async handleSessionStart(payload: Extract<ClientEvent, { type: "session.start" }>["payload"]): Promise<void> {
    const traceContext = createTraceContext({ turnId: createTurnId() });
    const pendingPermissions = new Map<string, PendingPermission>();

    residentCoreLog({
      level: "info",
      message: "session.start: boundary entered",
      decision_id: IPC_START_001,
      trace_id: traceContext.traceId,
      turn_id: traceContext.turnId,
      data: {
        cwd: payload.cwd,
        hasTitle: Boolean(payload.title),
        promptLength: payload.prompt.length,
      },
    });

    debug(
      "session.start: starting new session",
      { prompt: payload.prompt.slice(0, 50), cwd: payload.cwd },
      traceContext,
    );

    try {
      let conversationId: string | null = null;
      let handle: RunnerHandle | null = null;

      debug("session.start: calling runLetta", undefined, traceContext);
      handle = await runLetta({
        prompt: payload.prompt,
        session: {
          id: "pending",
          title: payload.title,
          status: "running",
          cwd: payload.cwd,
          pendingPermissions,
        },
        trace: traceContext,
        runtime: { sessionOwner: this.sessionOwner },
        onEvent: (event) => {
          this.emit(conversationId ? remapEventSessionId(event, conversationId) : event);
        },
        onSessionUpdate: (updates) => {
          debug("session.start: onSessionUpdate called", { updates }, traceContext);
          if (updates.lettaConversationId && !conversationId) {
            conversationId = updates.lettaConversationId;
            debug("session.start: session initialized", { conversationId }, traceContext);

            this.sessionStore.ensure(conversationId, {
              title: payload.title || conversationId,
              cwd: payload.cwd,
              status: "running",
              pendingPermissions,
            });
            if (handle) {
              this.runnerRegistry.set(conversationId, handle);
            }

            this.emit({
              type: "session.status",
              payload: {
                sessionId: conversationId,
                status: "running",
                title: conversationId,
                cwd: payload.cwd,
              },
            });
            this.emit({
              type: "stream.user_prompt",
              payload: { sessionId: conversationId, prompt: payload.prompt },
            });
          }
        },
      });

      if (conversationId) {
        this.runnerRegistry.set(conversationId, handle);
      }

      debug("session.start: runLetta returned handle", undefined, traceContext);
    } catch (error) {
      log("session.start: ERROR", { error: String(error) }, traceContext);
      this.emit({
        type: "runner.error",
        payload: {
          message: String(error),
          traceId: traceContext.traceId,
          sessionId: traceContext.sessionId,
        },
      });
    }
  }

  private async handleSessionContinue(
    payload: Extract<ClientEvent, { type: "session.continue" }>["payload"],
  ): Promise<void> {
    const conversationId = payload.sessionId;
    const traceContext = createTraceContext({
      turnId: createTurnId(),
      sessionId: conversationId,
    });

    residentCoreLog({
      level: "info",
      message: "session.continue: boundary entered",
      decision_id: IPC_CONTINUE_001,
      trace_id: traceContext.traceId,
      turn_id: traceContext.turnId,
      session_id: traceContext.sessionId,
      data: {
        cwd: payload.cwd,
        promptLength: payload.prompt.length,
      },
    });

    debug(
      "session.continue: continuing session",
      { conversationId, prompt: payload.prompt.slice(0, 50) },
      traceContext,
    );

    if (isConversationTurnActive(conversationId)) {
      this.emit({
        type: "session.status",
        payload: {
          sessionId: conversationId,
          status: "error",
          error: "Conversation already has an active reusable turn.",
        },
      });
      return;
    }

    let runtimeSession = this.sessionStore.get(conversationId);

    if (!runtimeSession) {
      debug("session.continue: no runtime session found, creating new one", undefined, traceContext);
      runtimeSession = this.sessionStore.ensure(conversationId, {
        title: conversationId,
        cwd: payload.cwd,
      });
    } else {
      debug("session.continue: found existing runtime session", { status: runtimeSession.status }, traceContext);
    }

    this.sessionStore.update(conversationId, { status: "running" });
    this.emit({
      type: "session.status",
      payload: { sessionId: conversationId, status: "running" },
    });

    this.emit({
      type: "stream.user_prompt",
      payload: { sessionId: conversationId, prompt: payload.prompt },
    });

    try {
      debug("session.continue: calling runLetta", { conversationId }, traceContext);
      let actualConversationId = conversationId;
      let handle: RunnerHandle | null = null;

      handle = await runLetta({
        prompt: payload.prompt,
        session: {
          id: conversationId,
          title: conversationId,
          status: "running",
          cwd: payload.cwd,
          pendingPermissions: runtimeSession.pendingPermissions,
        },
        resumeConversationId: conversationId,
        trace: traceContext,
        runtime: { sessionOwner: this.sessionOwner },
        onEvent: (event) => {
          this.emit(
            actualConversationId !== conversationId ? remapEventSessionId(event, actualConversationId) : event,
          );
        },
        onSessionUpdate: (updates) => {
          if (updates.lettaConversationId && updates.lettaConversationId !== conversationId) {
            log(
              "session.continue: received new conversationId from runner",
              {
                old: conversationId,
                new: updates.lettaConversationId,
              },
              traceContext,
            );
            actualConversationId = updates.lettaConversationId;

            this.sessionStore.rekey(conversationId, actualConversationId, {
              title: actualConversationId,
              cwd: payload.cwd,
              status: "running",
            });
            if (handle) {
              this.runnerRegistry.delete(conversationId);
              this.runnerRegistry.set(actualConversationId, handle);
            }

            this.emit({ type: "session.deleted", payload: { sessionId: conversationId } });
            this.emit({
              type: "session.status",
              payload: {
                sessionId: actualConversationId,
                status: "running",
                title: actualConversationId,
                cwd: payload.cwd,
              },
            });
            this.emit({
              type: "stream.user_prompt",
              payload: { sessionId: actualConversationId, prompt: payload.prompt },
            });
          }
        },
      });

      this.runnerRegistry.set(actualConversationId, handle);
      debug("session.continue: runLetta returned handle", undefined, traceContext);
    } catch (error) {
      log("session.continue: ERROR", { error: String(error) }, traceContext);
      this.sessionStore.update(conversationId, { status: "error" });
      this.emit({
        type: "session.status",
        payload: { sessionId: conversationId, status: "error", error: String(error) },
      });
    }
  }

  private async handleSessionStop(conversationId: string): Promise<void> {
    const traceContext = createSessionTraceContext(conversationId);

    residentCoreLog({
      level: "info",
      message: "session.stop: boundary entered",
      decision_id: SESSION_STOP_001,
      trace_id: traceContext.traceId,
      turn_id: traceContext.turnId,
      session_id: traceContext.sessionId,
      data: { conversationId },
    });

    finishCodeIslandObservation(conversationId, { reason: "user", success: false });
    const handle = this.runnerRegistry.get(conversationId);
    let stopError: unknown;
    let stopCompleted = false;

    if (handle) {
      try {
        await handle.abort();
        stopCompleted = true;
      } catch (error) {
        stopError = error;
        residentCoreLog({
          level: "error",
          message: "session.stop: abort failed",
          decision_id: SESSION_STOP_003,
          error_code: E_SESSION_STOP_FAILED,
          trace_id: traceContext.traceId,
          turn_id: traceContext.turnId,
          session_id: traceContext.sessionId,
          data: {
            conversationId,
            error: String(error),
          },
        });
      } finally {
        this.runnerRegistry.delete(conversationId);
      }
    }

    discardReusableConversationSession(conversationId);
    this.sessionStore.update(conversationId, { status: "idle" });
    this.emit({
      type: "session.status",
      payload: { sessionId: conversationId, status: "idle" },
    });

    if (!handle) {
      residentCoreLog({
        level: "warn",
        message: "session.stop: no active runner handle found",
        decision_id: SESSION_STOP_002,
        trace_id: traceContext.traceId,
        turn_id: traceContext.turnId,
        session_id: traceContext.sessionId,
        data: { conversationId },
      });
    }

    if (stopError) {
      log(
        "session.stop: handled abort error and completed cleanup",
        {
          conversationId,
          error: String(stopError),
        },
        traceContext,
      );
    }

    if (stopCompleted) {
      residentCoreLog({
        level: "info",
        message: "session.stop: abort completed",
        decision_id: SESSION_STOP_002,
        trace_id: traceContext.traceId,
        turn_id: traceContext.turnId,
        session_id: traceContext.sessionId,
        data: { conversationId },
      });
    }
  }

  private async handleSessionDelete(conversationId: string): Promise<void> {
    const traceContext = createSessionTraceContext(conversationId);

    residentCoreLog({
      level: "info",
      message: "session.delete: boundary entered",
      decision_id: SESSION_DELETE_001,
      trace_id: traceContext.traceId,
      turn_id: traceContext.turnId,
      session_id: traceContext.sessionId,
      data: { conversationId },
    });

    finishCodeIslandObservation(conversationId, { reason: "user", success: false });
    const handle = this.runnerRegistry.get(conversationId);
    if (handle) {
      try {
        await handle.abort();
        residentCoreLog({
          level: "info",
          message: "session.delete: abort completed",
          decision_id: SESSION_DELETE_002,
          trace_id: traceContext.traceId,
          turn_id: traceContext.turnId,
          session_id: traceContext.sessionId,
          data: { conversationId },
        });
      } catch (error) {
        residentCoreLog({
          level: "error",
          message: "session.delete: abort failed",
          decision_id: SESSION_DELETE_003,
          error_code: E_SESSION_STOP_FAILED,
          trace_id: traceContext.traceId,
          turn_id: traceContext.turnId,
          session_id: traceContext.sessionId,
          data: {
            conversationId,
            error: String(error),
          },
        });
      } finally {
        this.runnerRegistry.delete(conversationId);
      }
    } else {
      residentCoreLog({
        level: "warn",
        message: "session.delete: no active runner handle found",
        decision_id: SESSION_DELETE_002,
        trace_id: traceContext.traceId,
        turn_id: traceContext.turnId,
        session_id: traceContext.sessionId,
        data: { conversationId },
      });
    }

    this.sessionStore.delete(conversationId);
    clearCodeIslandObservation(conversationId);
    discardReusableConversationSession(conversationId);

    this.emit({ type: "session.deleted", payload: { sessionId: conversationId } });
  }

  private async handlePermissionResponse(
    payload: Extract<ClientEvent, { type: "permission.response" }>["payload"],
  ): Promise<void> {
    const session = this.sessionStore.get(payload.sessionId);
    const traceContext = createSessionTraceContext(payload.sessionId);

    residentCoreLog({
      level: "info",
      message: "permission.response: received",
      decision_id: PERMISSION_RESPONSE_001,
      trace_id: traceContext.traceId,
      turn_id: traceContext.turnId,
      session_id: traceContext.sessionId,
      data: {
        toolUseId: payload.toolUseId,
      },
    });

    if (!session) {
      residentCoreLog({
        level: "warn",
        message: "permission.response: session missing",
        decision_id: PERMISSION_RESPONSE_003,
        error_code: E_PERMISSION_RESPONSE_MISSING,
        trace_id: traceContext.traceId,
        turn_id: traceContext.turnId,
        session_id: traceContext.sessionId,
        data: {
          toolUseId: payload.toolUseId,
        },
      });
      this.emit({
        type: "runner.error",
        payload: {
          sessionId: payload.sessionId,
          traceId: traceContext.traceId,
          message: "Permission response received without an active session.",
        },
      });
      return;
    }

    const pending = session.pendingPermissions.get(payload.toolUseId);
    if (pending) {
      residentCoreLog({
        level: "info",
        message: "permission.response: applied",
        decision_id: PERMISSION_RESPONSE_002,
        trace_id: traceContext.traceId,
        turn_id: traceContext.turnId,
        session_id: traceContext.sessionId,
        data: {
          toolUseId: payload.toolUseId,
        },
      });
      pending.resolve(payload.result);
      return;
    }

    residentCoreLog({
      level: "warn",
      message: "permission.response: pending request missing",
      decision_id: PERMISSION_RESPONSE_003,
      error_code: E_PERMISSION_RESPONSE_MISSING,
      trace_id: traceContext.traceId,
      turn_id: traceContext.turnId,
      session_id: traceContext.sessionId,
      data: {
        toolUseId: payload.toolUseId,
      },
    });
    this.emit({
      type: "runner.error",
      payload: {
        sessionId: payload.sessionId,
        traceId: traceContext.traceId,
        message: "Permission response did not match an active pending request.",
      },
    });
  }

  async handleClientEvent(event: ClientEvent): Promise<void> {
    debug(`handleClientEvent: ${event.type}`, {
      payload: "payload" in event ? event.payload : undefined,
    });

    switch (event.type) {
      case "session.list":
        await this.handleSessionList();
        return;
      case "session.history":
        await this.handleSessionHistory(event.payload.sessionId);
        return;
      case "session.start":
        await this.handleSessionStart(event.payload);
        return;
      case "session.continue":
        await this.handleSessionContinue(event.payload);
        return;
      case "session.stop":
        await this.handleSessionStop(event.payload.sessionId);
        return;
      case "session.delete":
        await this.handleSessionDelete(event.payload.sessionId);
        return;
      case "permission.response":
        await this.handlePermissionResponse(event.payload);
        return;
    }
  }

  cleanupAllSessions(): void {
    try {
      for (const [conversationId, handle] of this.runnerRegistry.entries()) {
        finishCodeIslandObservation(conversationId, { reason: "user", success: false });
        void handle.abort().catch((error) => {
          log("cleanupAllSessions: abort failed", {
            conversationId,
            error: String(error),
          });
        });
        clearCodeIslandObservation(conversationId);
      }
    } finally {
      this.runnerRegistry.clear();
      this.sessionStore.clear();
      this.sessionOwner.invalidateDesktopSession();
      discardAllReusableConversationSessions();
    }
  }
}

export function createResidentCoreService(
  broadcast: ResidentCoreBroadcast,
  sessionOwner: ResidentCoreSessionOwner,
): ResidentCoreService {
  return new ResidentCoreService(broadcast, sessionOwner);
}
