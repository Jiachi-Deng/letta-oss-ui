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
  onEvent: (event: ServerEvent) => void;
  onSessionUpdate?: (updates: { lettaConversationId?: string }) => void;
};

export type RunnerHandle = {
  abort: () => Promise<void>;
};

const DEFAULT_CWD = process.cwd();
const DEBUG = process.env.DEBUG_RUNNER === "true";

// Simple logger for runner
const log = (msg: string, data?: Record<string, unknown>) => {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] [runner] ${msg}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${timestamp}] [runner] ${msg}`);
  }
};

// Debug-only logging (verbose)
const debug = (msg: string, data?: Record<string, unknown>) => {
  if (!DEBUG) return;
  log(msg, data);
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
  
  debug("runLetta called", {
    prompt: prompt.slice(0, 100) + (prompt.length > 100 ? "..." : ""),
    sessionId: session.id,
    resumeConversationId,
    cachedAgentId,
    cwd: session.cwd,
  });

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
      const runtimeConnection = await prepareRuntimeConnection(appConfigState.config);
      reusableSessionSignature = JSON.stringify({
        baseUrl: runtimeConnection.baseUrl,
        modelHandle: runtimeConnection.modelHandle ?? "",
        cwd: session.cwd ?? DEFAULT_CWD,
      });
      log("runtime connection ready", {
        connectionType: appConfigState.config.connectionType,
        baseUrl: runtimeConnection.baseUrl,
        modelHandle: runtimeConnection.modelHandle,
        bootstrapAction: runtimeConnection.bootstrapAction.kind,
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
        debug("session initialized", { conversationId: lettaSession.conversationId, agentId: lettaSession.agentId });
        onSessionUpdate?.({ lettaConversationId: lettaSession.conversationId });
        if (!turnLockHeld) {
          beginReusableConversationTurn(lettaSession.conversationId);
          turnLockHeld = true;
        }
        beginCodeIslandObservation(currentSessionId, session.cwd, prompt);
      } else {
        log("WARNING: no conversationId available after send()");
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
            mirrorCodeIslandAssistantMessage(currentSessionId, assistantText);
          }
        }

        // Check for result to update session status
        if (message.type === "result") {
          const status = message.success ? "completed" : "error";
          debug("result received", { success: message.success, status });
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
        stack: (error as Error).stack 
      });
      keepReusableSession = false;
      finishCodeIslandObservation(currentSessionId, { error: String(error) });
      if (currentSessionId === "pending") {
        onEvent({
          type: "runner.error",
          payload: { message: String(error) }
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
        });
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
