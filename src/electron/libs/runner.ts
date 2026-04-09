import {
  createSession,
  resumeSession,
  type Session as LettaSession,
  type SDKMessage,
  type CanUseToolResponse,
} from "@letta-ai/letta-code-sdk";
import type { ServerEvent, SessionStatus } from "../types.js";
import type { PendingPermission } from "./runtime-state.js";
import {
  normalizeMessageContent,
  normalizeSDKMessageForApp,
} from "../../shared/message-normalizer.js";
import { getAppConfigState } from "./config.js";
import {
  prepareRuntimeConnection,
} from "./provider-bootstrap.js";
import {
  beginCodeIslandObservation,
  finishCodeIslandObservation,
  mirrorCodeIslandAssistantMessage,
  mirrorCodeIslandToolResult,
  mirrorCodeIslandToolRunning,
} from "./codeisland-observer.js";
import {
  acquireReusableConversationSession,
  beginReusableConversationTurn,
  completeReusableConversationTurn,
} from "./conversation-session-cache.js";
import {
  E_SESSION_CONVERSATION_ID_MISSING,
  E_STREAM_EMPTY_RESULT,
} from "../../shared/error-codes.js";
import {
  RUNNER_INIT_001,
  RUNNER_INIT_002,
  PERMISSION_REQUEST_001,
  STREAM_001,
  STREAM_002,
  STREAM_EMPTY_RESULT_001,
} from "../../shared/decision-ids.js";
import {
  createComponentLogger,
  createTraceContext,
  extendTraceContext,
  type TraceContext,
} from "./trace.js";

// Simplified session type for runner
export type RunnerSession = {
  id: string;
  title: string;
  status: string;
  cwd?: string;
  pendingPermissions: Map<string, PendingPermission>;
};

export type RunnerOptions = {
  prompt: string;
  session: RunnerSession;
  resumeConversationId?: string;
  trace?: TraceContext;
  onEvent: (event: ServerEvent) => void;
  onSessionUpdate?: (updates: { lettaConversationId?: string }) => void;
};

export type RunnerHandle = {
  abort: () => Promise<void>;
};

const DEFAULT_CWD = process.cwd();
const DEBUG = process.env.DEBUG_RUNNER === "true";
const runnerLog = createComponentLogger("runner");

const log = (
  msg: string,
  data?: Record<string, unknown>,
  context?: TraceContext,
) => {
  runnerLog({
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
  runnerLog({
    level: "debug",
    message: msg,
    data,
    trace_id: context?.traceId,
    turn_id: context?.turnId,
    session_id: context?.sessionId,
  });
};

// Store agentId for reuse across conversations
let cachedAgentId: string | null = null;

export async function runLetta(options: RunnerOptions): Promise<RunnerHandle> {
  const { prompt, session, resumeConversationId, onEvent, onSessionUpdate } = options;
  let activeLettaSession: LettaSession | null = null;
  let terminalStatus: SessionStatus | null = null;
  let activeConversationId: string | null = null;
  let keepReusableSession = false;
  let turnLockHeld = false;
  let reusableSessionSignature = "";
  let traceContext = options.trace ?? createTraceContext();
  let assistantOutputSeen = false;
  if (session.id !== "pending") {
    traceContext = extendTraceContext(traceContext, { sessionId: session.id });
  }
  
  debug(
    "runLetta called",
    {
      prompt: prompt.slice(0, 100) + (prompt.length > 100 ? "..." : ""),
      sessionId: session.id,
      resumeConversationId,
      cachedAgentId,
      cwd: session.cwd,
    },
    traceContext,
  );

  // Mutable sessionId - starts as session.id, updated when conversationId is available
  let currentSessionId = session.id;

  const sendMessage = (message: SDKMessage) => {
    const normalizedMessage = normalizeSDKMessageForApp(message);
    onEvent({
      type: "stream.message",
      payload: { sessionId: currentSessionId, message: normalizedMessage }
    });
  };

  const sendPermissionRequest = (toolUseId: string, toolName: string, input: unknown) => {
    runnerLog({
      level: "info",
      message: "permission request emitted",
      decision_id: PERMISSION_REQUEST_001,
      trace_id: traceContext.traceId,
      turn_id: traceContext.turnId,
      session_id: traceContext.sessionId,
      data: {
        toolUseId,
        toolName,
      },
    });
    onEvent({
      type: "permission.request",
      payload: { sessionId: currentSessionId, toolUseId, toolName, input }
    });
  };

  const sendSessionStatus = (
    status: SessionStatus,
    extra: { error?: string } = {},
  ) => {
    terminalStatus = status;
    onEvent({
      type: "session.status",
      payload: { sessionId: currentSessionId, status, title: currentSessionId, ...extra }
    });
  };

  // Start the query in the background
  (async () => {
    try {
      // Common options for canUseTool
      const canUseTool = async (toolName: string, input: unknown) => {
        // For AskUserQuestion, we need to wait for user response
        if (toolName === "AskUserQuestion") {
          const toolUseId = crypto.randomUUID();
          sendPermissionRequest(toolUseId, toolName, input);
          return new Promise<CanUseToolResponse>((resolve) => {
            session.pendingPermissions.set(toolUseId, {
              toolUseId,
              toolName,
              input,
              resolve: (result) => {
                session.pendingPermissions.delete(toolUseId);
                resolve(result);
              }
            });
          });
        }
        return { behavior: "allow" as const };
      };

      // Session options
      const appConfigState = getAppConfigState();
      const runtimeConnection = await prepareRuntimeConnection(
        appConfigState.config,
        traceContext,
      );
      reusableSessionSignature = JSON.stringify({
        baseUrl: runtimeConnection.baseUrl,
        modelHandle: runtimeConnection.modelHandle ?? "",
        cwd: session.cwd ?? DEFAULT_CWD,
      });
      runnerLog({
        level: "info",
        message: "runtime connection ready",
        decision_id: RUNNER_INIT_001,
        trace_id: traceContext.traceId,
        turn_id: traceContext.turnId,
        session_id: traceContext.sessionId,
        data: {
          connectionType: appConfigState.config.connectionType,
          baseUrl: runtimeConnection.baseUrl,
          modelHandle: runtimeConnection.modelHandle,
          bootstrapAction: runtimeConnection.bootstrapAction.kind,
        },
      });

      const sessionOptions = {
        cwd: session.cwd ?? DEFAULT_CWD,
        permissionMode: "bypassPermissions" as const,
        canUseTool,
        model: runtimeConnection.modelHandle,
      };

      // Create or resume session
      let lettaSession: LettaSession;

      const isConversationId = (id: string | undefined): boolean => {
        if (!id) return false;
        return /^(conv-|conversation-|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.test(id);
      };

      const isAgentId = (id: string | undefined): boolean => {
        if (!id) return false;
        return /^agent-/.test(id);
      };

      if (resumeConversationId && isConversationId(resumeConversationId)) {
        const reusableSession = acquireReusableConversationSession(
          resumeConversationId,
          reusableSessionSignature,
        );

        if (reusableSession) {
          debug("creating session: reusing cached session with conversationId", { resumeConversationId });
          lettaSession = reusableSession;
          activeConversationId = resumeConversationId;
          turnLockHeld = true;
        } else {
          debug("creating session: resumeSession with conversationId", { resumeConversationId });
          lettaSession = resumeSession(resumeConversationId, sessionOptions);
        }
      } else if (resumeConversationId && isAgentId(resumeConversationId)) {
        // The current SDK maps resumeSession(agentId) to a CLI --default flag path,
        // which this CLI build does not support. Use a new conversation on the
        // existing agent instead.
        debug("creating session: createSession with agentId", { agentId: resumeConversationId });
        lettaSession = createSession(resumeConversationId, sessionOptions);
      } else if (resumeConversationId) {
        // Invalid ID provided - log warning and fall back to cachedAgentId
        log("WARNING: invalid resumeConversationId, falling back", { 
          invalidId: resumeConversationId, 
          fallbackTo: cachedAgentId ? "cachedAgentId" : "createSession" 
        });
        if (cachedAgentId) {
          debug("creating session: createSession with cachedAgentId (fallback)", { cachedAgentId });
          lettaSession = createSession(cachedAgentId, sessionOptions);
        } else {
          debug("creating session: createSession (new agent, fallback)");
          lettaSession = createSession(undefined, sessionOptions);
        }
      } else if (cachedAgentId) {
        // Create new conversation on existing agent
        debug("creating session: createSession with cachedAgentId", { cachedAgentId });
        lettaSession = createSession(cachedAgentId, sessionOptions);
      } else {
        // First time - create new agent and session
        debug("creating session: createSession (new agent)");
        lettaSession = createSession(undefined, sessionOptions);
      }
      debug("session created successfully");

      // Store for abort handling
      activeLettaSession = lettaSession;

      // Send the prompt (triggers init internally)
      debug("calling send()");
      await lettaSession.send(prompt);
      debug("send() completed", {
        conversationId: lettaSession.conversationId,
        agentId: lettaSession.agentId,
      });

      // Now initialized - update sessionId and cache agentId
      if (lettaSession.conversationId) {
        currentSessionId = lettaSession.conversationId;
        activeConversationId = lettaSession.conversationId;
        traceContext = extendTraceContext(traceContext, {
          sessionId: lettaSession.conversationId,
        });
        debug(
          "session initialized",
          { conversationId: lettaSession.conversationId, agentId: lettaSession.agentId },
          traceContext,
        );
        onSessionUpdate?.({ lettaConversationId: lettaSession.conversationId });
        if (!turnLockHeld) {
          beginReusableConversationTurn(lettaSession.conversationId);
          turnLockHeld = true;
        }
        beginCodeIslandObservation(currentSessionId, session.cwd, prompt);
      } else {
        runnerLog({
          level: "warn",
          message: "WARNING: no conversationId available after send()",
          decision_id: RUNNER_INIT_002,
          error_code: E_SESSION_CONVERSATION_ID_MISSING,
          trace_id: traceContext.traceId,
          turn_id: traceContext.turnId,
          session_id: traceContext.sessionId,
        });
      }

      // Cache agentId for future conversations
      if (lettaSession.agentId && !cachedAgentId) {
        cachedAgentId = lettaSession.agentId;
        debug("cached agentId for future conversations", { agentId: cachedAgentId });
      }

      // Stream messages
      debug("starting stream");
      let messageCount = 0;
      for await (const message of lettaSession.stream()) {
        messageCount++;
        debug("received message", { type: message.type, count: messageCount });
        
        // Send message directly to frontend (no transform needed)
        sendMessage(message);

        if (message.type === "tool_call") {
          mirrorCodeIslandToolRunning(currentSessionId, message.toolCallId, message.toolName);
        }

        if (message.type === "tool_result") {
          mirrorCodeIslandToolResult(currentSessionId, message.toolCallId, message.isError);
        }

        if (message.type === "assistant") {
          const assistantText = normalizeMessageContent(message.content);
          if (assistantText.trim()) {
            if (!assistantOutputSeen) {
              assistantOutputSeen = true;
              runnerLog({
                level: "info",
                message: "first assistant output observed",
                decision_id: STREAM_001,
                trace_id: traceContext.traceId,
                turn_id: traceContext.turnId,
                session_id: traceContext.sessionId,
                data: {
                  preview: assistantText.slice(0, 120),
                },
              });
            }
            mirrorCodeIslandAssistantMessage(currentSessionId, assistantText);
          }
        }

        // Check for result to update session status
        if (message.type === "result") {
          const status = message.success ? "completed" : "error";
          debug("result received", { success: message.success, status });
          runnerLog({
            level: message.success && !assistantOutputSeen ? "warn" : message.success ? "info" : "warn",
            message: message.success && !assistantOutputSeen
              ? "stream result completed without assistant output"
              : "stream result received",
            decision_id:
              message.success && !assistantOutputSeen
                ? STREAM_EMPTY_RESULT_001
                : STREAM_002,
            error_code:
              message.success && !assistantOutputSeen
                ? E_STREAM_EMPTY_RESULT
                : undefined,
            trace_id: traceContext.traceId,
            turn_id: traceContext.turnId,
            session_id: traceContext.sessionId,
            data: {
              success: message.success,
              status,
              assistantOutputSeen,
            },
          });
          keepReusableSession = message.success;
          finishCodeIslandObservation(currentSessionId, {
            success: message.success,
            error: message.success ? undefined : String(message.error),
          });
          sendSessionStatus(status, message.success ? undefined : { error: message.error });
        }
      }
      debug("stream ended", { totalMessages: messageCount });

      // Query completed normally
      if (terminalStatus === null) {
        debug("query completed normally");
        runnerLog({
          level: assistantOutputSeen ? "info" : "warn",
          message: assistantOutputSeen
            ? "stream completed without explicit result message"
            : "stream completed without assistant output",
          decision_id: assistantOutputSeen ? STREAM_002 : STREAM_EMPTY_RESULT_001,
          error_code: assistantOutputSeen ? undefined : E_STREAM_EMPTY_RESULT,
          trace_id: traceContext.traceId,
          turn_id: traceContext.turnId,
          session_id: traceContext.sessionId,
          data: {
            assistantOutputSeen,
          },
        });
        keepReusableSession = true;
        finishCodeIslandObservation(currentSessionId, { success: true });
        sendSessionStatus("completed");
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        // Session was aborted, don't treat as error
        debug("session aborted");
        return;
      }
      log("ERROR in runLetta", {
        error: String(error),
        name: (error as Error).name,
        stack: (error as Error).stack,
      }, traceContext);
      keepReusableSession = false;
      finishCodeIslandObservation(currentSessionId, { error: String(error) });
      if (currentSessionId === "pending") {
        onEvent({
          type: "runner.error",
          payload: {
            message: String(error),
            traceId: traceContext.traceId,
            sessionId: traceContext.sessionId,
          }
        });
        return;
      }
      sendSessionStatus("error", { error: String(error) });
    } finally {
      debug("runLetta finally block, clearing activeLettaSession");
      try {
        if (activeLettaSession) {
          if (activeConversationId && turnLockHeld) {
            completeReusableConversationTurn(
              activeLettaSession,
              reusableSessionSignature,
              keepReusableSession,
            );
          } else {
            activeLettaSession.close();
          }
        }
      } catch (closeError) {
        log("WARNING: failed to close Letta session transport", {
          error: String(closeError),
        }, traceContext);
      }
      activeLettaSession = null;
      activeConversationId = null;
      turnLockHeld = false;
    }
  })();

  return {
    abort: async () => {
      if (activeLettaSession) {
        await activeLettaSession.abort();
      }
    }
  };
}
