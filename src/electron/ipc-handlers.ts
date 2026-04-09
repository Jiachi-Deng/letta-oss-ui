import { BrowserWindow } from "electron";
import type { ClientEvent, ServerEvent } from "./types.js";
import {
  clearCodeIslandObservation,
  finishCodeIslandObservation,
} from "./libs/codeisland-observer.js";
import { runLetta, type RunnerHandle } from "./libs/runner.js";
import {
  discardAllReusableConversationSessions,
  discardReusableConversationSession,
  isConversationTurnActive,
} from "./libs/conversation-session-cache.js";
import type { PendingPermission } from "./libs/runtime-state.js";
import {
  appendSessionProjectionMessage,
  createSessionProjection,
  deleteSessionProjection,
  getSessionProjection,
  getSessionProjectionHistory,
  listSessionProjections,
  rekeySessionProjection,
  updateSessionProjection,
} from "./libs/runtime-state.js";
import {
  createComponentLogger,
  createTraceContext,
  createTurnId,
  type TraceContext,
} from "./libs/trace.js";
import {
  IPC_CONTINUE_001,
  IPC_START_001,
} from "../shared/decision-ids.js";

const DEBUG = process.env.DEBUG_IPC === "true";
const ipcLog = createComponentLogger("ipc");

const log = (
  msg: string,
  data?: Record<string, unknown>,
  context?: TraceContext,
) => {
  ipcLog({
    level: "info",
    message: msg,
    data,
    trace_id: context?.traceId,
    turn_id: context?.turnId,
    session_id: context?.sessionId,
  });
};

// Debug-only logging (verbose)
const debug = (
  msg: string,
  data?: Record<string, unknown>,
  context?: TraceContext,
) => {
  if (!DEBUG) return;
  ipcLog({
    level: "debug",
    message: msg,
    data,
    trace_id: context?.traceId,
    turn_id: context?.turnId,
    session_id: context?.sessionId,
  });
};

// Track active runner handles.
// The runner owns transport/process finalization; IPC only keeps bookkeeping
// so it can signal abort and forget finished handles.
const runnerHandles = new Map<string, RunnerHandle>();

function releaseRunnerHandle(conversationId: string): void {
  runnerHandles.delete(conversationId);
}

function broadcast(event: ServerEvent) {
  const payload = JSON.stringify(event);
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send("server-event", payload);
  }
}

function emit(event: ServerEvent) {
  if (event.type === "session.status") {
    const existing = getSessionProjection(event.payload.sessionId);
    if (existing) {
      updateSessionProjection(event.payload.sessionId, {
        status: event.payload.status,
        title: event.payload.title ?? existing.title,
        cwd: event.payload.cwd ?? existing.cwd,
        error: event.payload.error,
      });
    } else if (event.payload.sessionId !== "pending") {
      createSessionProjection(event.payload.sessionId, {
        status: event.payload.status,
        title: event.payload.title ?? event.payload.sessionId,
        cwd: event.payload.cwd,
        error: event.payload.error,
      });
    }

    if (event.payload.status === "completed" || event.payload.status === "error") {
      // Bookkeeping only: runner.ts owns the actual transport/process close.
      releaseRunnerHandle(event.payload.sessionId);
    }
  }

  if (event.type === "stream.user_prompt") {
    appendSessionProjectionMessage(event.payload.sessionId, {
      type: "user_prompt",
      prompt: event.payload.prompt,
    });
  }

  if (event.type === "stream.message") {
    appendSessionProjectionMessage(event.payload.sessionId, event.payload.message);
  }

  broadcast(event);
}

export async function handleClientEvent(event: ClientEvent) {
  debug(`handleClientEvent: ${event.type}`, { payload: 'payload' in event ? event.payload : undefined });
  
  if (event.type === "session.list") {
    emit({ type: "session.list", payload: { sessions: listSessionProjections() } });
    return;
  }

  if (event.type === "session.history") {
    const conversationId = event.payload.sessionId;
    const session = getSessionProjection(conversationId);
    emit({
      type: "session.history",
      payload: {
        sessionId: conversationId,
        status: session?.status ?? "idle",
        messages: getSessionProjectionHistory(conversationId),
      },
    });
    return;
  }

  if (event.type === "session.start") {
    const traceContext = createTraceContext({ turnId: createTurnId() });

    ipcLog({
      level: "info",
      message: "session.start: boundary entered",
      decision_id: IPC_START_001,
      trace_id: traceContext.traceId,
      turn_id: traceContext.turnId,
      data: {
        cwd: event.payload.cwd,
        hasTitle: Boolean(event.payload.title),
        promptLength: event.payload.prompt.length,
      },
    });

    debug(
      "session.start: starting new session",
      { prompt: event.payload.prompt.slice(0, 50), cwd: event.payload.cwd },
      traceContext,
    );
    const pendingPermissions = new Map<string, PendingPermission>();

    try {
      let conversationId: string | null = null;
      let handle: RunnerHandle | null = null;
      
      debug("session.start: calling runLetta", undefined, traceContext);
      handle = await runLetta({
        prompt: event.payload.prompt,
        session: {
          id: "pending",
          title: event.payload.title,
          status: "running",
          cwd: event.payload.cwd,
          pendingPermissions,
        },
        trace: traceContext,
        onEvent: (e) => {
          // Use conversationId for all events
          if (conversationId && "sessionId" in e.payload) {
            const payload = e.payload as { sessionId: string };
            payload.sessionId = conversationId;
          }
          emit(e);
        },
        onSessionUpdate: (updates) => {
          // Called when session is initialized with conversationId
          debug("session.start: onSessionUpdate called", { updates }, traceContext);
          if (updates.lettaConversationId && !conversationId) {
            conversationId = updates.lettaConversationId;
            debug("session.start: session initialized", { conversationId }, traceContext);
            
            createSessionProjection(conversationId, {
              title: event.payload.title || conversationId,
              cwd: event.payload.cwd,
              status: "running",
              pendingPermissions,
            });
            if (handle) runnerHandles.set(conversationId, handle);
            
            // Emit session.status to unblock UI - use conversationId as title
            emit({
              type: "session.status",
              payload: { sessionId: conversationId, status: "running", title: conversationId, cwd: event.payload.cwd },
            });
            emit({
              type: "stream.user_prompt",
              payload: { sessionId: conversationId, prompt: event.payload.prompt },
            });
          }
        },
      });
      debug("session.start: runLetta returned handle", undefined, traceContext);
    } catch (error) {
      log("session.start: ERROR", { error: String(error) }, traceContext);
      console.error("Failed to start session:", error);
      emit({
        type: "runner.error",
        payload: {
          message: String(error),
          traceId: traceContext.traceId,
          sessionId: traceContext.sessionId,
        },
      });
    }
    return;
  }

  if (event.type === "session.continue") {
    const conversationId = event.payload.sessionId;
    const traceContext = createTraceContext({
      turnId: createTurnId(),
      sessionId: conversationId,
    });

    ipcLog({
      level: "info",
      message: "session.continue: boundary entered",
      decision_id: IPC_CONTINUE_001,
      trace_id: traceContext.traceId,
      turn_id: traceContext.turnId,
      session_id: traceContext.sessionId,
      data: {
        cwd: event.payload.cwd,
        promptLength: event.payload.prompt.length,
      },
    });

    debug(
      "session.continue: continuing session",
      { conversationId, prompt: event.payload.prompt.slice(0, 50) },
      traceContext,
    );

    if (isConversationTurnActive(conversationId)) {
      emit({
        type: "session.status",
        payload: {
          sessionId: conversationId,
          status: "error",
          error: "Conversation already has an active reusable turn.",
        },
      });
      return;
    }
    
    let runtimeSession = getSessionProjection(conversationId);
    
    if (!runtimeSession) {
      debug("session.continue: no runtime session found, creating new one", undefined, traceContext);
      runtimeSession = createSessionProjection(conversationId, {
        title: conversationId,
        cwd: event.payload.cwd,
      });
    } else {
      debug("session.continue: found existing runtime session", { status: runtimeSession.status }, traceContext);
    }

    updateSessionProjection(conversationId, { status: "running" });
    emit({
      type: "session.status",
      payload: { sessionId: conversationId, status: "running" },
    });

    emit({
      type: "stream.user_prompt",
      payload: { sessionId: conversationId, prompt: event.payload.prompt },
    });

    try {
      debug("session.continue: calling runLetta", { conversationId }, traceContext);
      let actualConversationId = conversationId;
      let handle: RunnerHandle | null = null;
      
      handle = await runLetta({
        prompt: event.payload.prompt,
        session: {
          id: conversationId,
          title: conversationId,
          status: "running",
          cwd: event.payload.cwd,
          pendingPermissions: runtimeSession.pendingPermissions,
        },
        resumeConversationId: conversationId,
        trace: traceContext,
        onEvent: (e) => {
          // Update sessionId in events if we got a new conversationId
          if (actualConversationId !== conversationId && "sessionId" in e.payload) {
            const payload = e.payload as { sessionId: string };
            payload.sessionId = actualConversationId;
          }
          emit(e);
        },
        onSessionUpdate: (updates) => {
          // If we get a new conversationId (e.g., fallback from invalid ID), update everything
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
            
            rekeySessionProjection(conversationId, actualConversationId, {
              title: actualConversationId,
              cwd: event.payload.cwd,
              status: "running",
            });
            if (handle) {
              runnerHandles.delete(conversationId);
              runnerHandles.set(actualConversationId, handle);
            }

            // Delete the old invalid session from UI state
            emit({ type: "session.deleted", payload: { sessionId: conversationId } });

            // Notify UI about the new session
            emit({
              type: "session.status",
              payload: { 
                sessionId: actualConversationId, 
                status: "running", 
                title: actualConversationId, 
                cwd: event.payload.cwd 
              },
            });
            // Re-emit the user prompt for the new session
            emit({
              type: "stream.user_prompt",
              payload: { sessionId: actualConversationId, prompt: event.payload.prompt },
            });
          }
        },
      });
      debug("session.continue: runLetta returned handle", undefined, traceContext);
      runnerHandles.set(actualConversationId, handle);
    } catch (error) {
      log("session.continue: ERROR", { error: String(error) }, traceContext);
      updateSessionProjection(conversationId, { status: "error" });
      emit({
        type: "session.status",
        payload: { sessionId: conversationId, status: "error", error: String(error) },
      });
    }
    return;
  }

  if (event.type === "session.stop") {
    const conversationId = event.payload.sessionId;
    debug("session.stop: stopping session", { conversationId });
    finishCodeIslandObservation(conversationId, { reason: "user", success: false });
    const handle = runnerHandles.get(conversationId);
    if (handle) {
      debug("session.stop: aborting handle");
      try {
        await handle.abort();
      } finally {
        releaseRunnerHandle(conversationId);
      }
    } else {
      debug("session.stop: no handle found");
    }
    discardReusableConversationSession(conversationId);
    updateSessionProjection(conversationId, { status: "idle" });
    emit({
      type: "session.status",
      payload: { sessionId: conversationId, status: "idle" },
    });
    return;
  }

  if (event.type === "session.delete") {
    const conversationId = event.payload.sessionId;
    finishCodeIslandObservation(conversationId, { reason: "user", success: false });
    const handle = runnerHandles.get(conversationId);
    if (handle) {
      try {
        await handle.abort();
      } finally {
        releaseRunnerHandle(conversationId);
      }
    }
    deleteSessionProjection(conversationId);
    clearCodeIslandObservation(conversationId);
    discardReusableConversationSession(conversationId);
    
    // Note: Letta client may not have a delete method for conversations
    // The conversation will remain in Letta but be removed from our UI
    
    emit({ type: "session.deleted", payload: { sessionId: conversationId } });
    return;
  }

  if (event.type === "permission.response") {
    const session = getSessionProjection(event.payload.sessionId);
    if (!session) return;

    const pending = session.pendingPermissions.get(event.payload.toolUseId);
    if (pending) {
      pending.resolve(event.payload.result);
    }
    return;
  }
}

export function cleanupAllSessions(): void {
  try {
    for (const [conversationId, handle] of runnerHandles) {
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
    runnerHandles.clear();
    discardAllReusableConversationSessions();
  }
}
