/**
 * App-facing message types for UI communication.
 * Normalization lives in src/shared/message-normalizer.ts.
 */

import type {
  AppAssistantMessage,
  AppInitMessage,
  AppMessage,
  AppReasoningMessage,
  AppResultMessage,
  AppStreamEventMessage,
  AppStreamMessage,
  AppToolCallMessage,
  AppToolResultMessage,
  UserPromptMessage,
} from "../shared/message-normalizer.js";
import type { CanUseToolResponse } from "@letta-ai/letta-code-sdk";

export type SDKMessage = AppStreamMessage;
export type SDKInitMessage = AppInitMessage;
export type SDKAssistantMessage = AppAssistantMessage;
export type SDKToolCallMessage = AppToolCallMessage;
export type SDKToolResultMessage = AppToolResultMessage;
export type SDKReasoningMessage = AppReasoningMessage;
export type SDKResultMessage = AppResultMessage;
export type SDKStreamEventMessage = AppStreamEventMessage;
export type StreamMessage = AppMessage;
export type { UserPromptMessage, CanUseToolResponse };

export type SessionStatus = "idle" | "running" | "completed" | "error";

export type SessionInfo = {
  id: string;
  title: string;
  status: SessionStatus;
  lettaConversationId?: string;
  cwd?: string;
  createdAt: number;
  updatedAt: number;
};

// Server -> Client events
export type ServerEvent =
  | { type: "stream.message"; payload: { sessionId: string; message: StreamMessage } }
  | { type: "stream.user_prompt"; payload: { sessionId: string; prompt: string } }
  | { type: "session.status"; payload: { sessionId: string; status: SessionStatus; title?: string; cwd?: string; error?: string } }
  | { type: "session.list"; payload: { sessions: SessionInfo[] } }
  | { type: "session.history"; payload: { sessionId: string; status: SessionStatus; messages: StreamMessage[] } }
  | { type: "session.deleted"; payload: { sessionId: string } }
  | { type: "permission.request"; payload: { sessionId: string; toolUseId: string; toolName: string; input: unknown } }
  | { type: "runner.error"; payload: { sessionId?: string; traceId?: string; message: string } };

// Client -> Server events
export type ClientEvent =
  | { type: "session.start"; payload: { title: string; prompt: string; cwd?: string; allowedTools?: string } }
  | { type: "session.continue"; payload: { sessionId: string; prompt: string; cwd?: string } }
  | { type: "session.stop"; payload: { sessionId: string } }
  | { type: "session.delete"; payload: { sessionId: string } }
  | { type: "session.list" }
  | { type: "session.history"; payload: { sessionId: string } }
  | { type: "permission.response"; payload: { sessionId: string; toolUseId: string; result: CanUseToolResponse } };
