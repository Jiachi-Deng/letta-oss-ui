/**
 * Transient in-memory projection of active sessions for the desktop UI.
 *
 * Letta server is the persistence authority for conversations, messages, and
 * agent state. This module only keeps ephemeral view/cache state so the app can
 * render active sessions and pending approvals while a turn is in flight.
 */

import type {
  CanUseToolResponse,
  SessionInfo,
  SessionStatus,
  StreamMessage,
} from "../types.js";

export type PendingPermission = {
  toolUseId: string;
  toolName: string;
  input: unknown;
  resolve: (result: CanUseToolResponse) => void;
};

export type SessionProjection = {
  conversationId: string;
  title: string;
  cwd?: string;
  createdAt: number;
  updatedAt: number;
  agentId?: string;
  status: SessionStatus;
  error?: string;
  pendingPermissions: Map<string, PendingPermission>;
  messages: StreamMessage[];
};

// In-memory projection cache for active sessions.
const sessionProjections = new Map<string, SessionProjection>();

type SessionProjectionSeed = {
  title?: string;
  cwd?: string;
  createdAt?: number;
  updatedAt?: number;
  agentId?: string;
  status?: SessionStatus;
  error?: string;
  pendingPermissions?: Map<string, PendingPermission>;
  messages?: StreamMessage[];
};

function now(): number {
  return Date.now();
}

export function createSessionProjection(
  conversationId: string,
  seed: SessionProjectionSeed = {},
): SessionProjection {
  const existing = sessionProjections.get(conversationId);
  if (existing) {
    return updateSessionProjection(conversationId, seed) ?? existing;
  }

  const timestamp = seed.createdAt ?? now();
  const session: SessionProjection = {
    conversationId,
    title: seed.title ?? conversationId,
    cwd: seed.cwd,
    createdAt: timestamp,
    updatedAt: seed.updatedAt ?? timestamp,
    agentId: seed.agentId,
    status: seed.status ?? "idle",
    error: seed.error,
    pendingPermissions: seed.pendingPermissions ?? new Map(),
    messages: seed.messages ? [...seed.messages] : [],
  };
  sessionProjections.set(conversationId, session);
  return session;
}

export function getSessionProjection(conversationId: string): SessionProjection | undefined {
  return sessionProjections.get(conversationId);
}

export function updateSessionProjection(
  conversationId: string,
  updates: Partial<SessionProjection>,
): SessionProjection | undefined {
  const session = sessionProjections.get(conversationId);
  if (!session) return undefined;
  Object.assign(session, {
    ...updates,
    updatedAt: updates.updatedAt ?? now(),
  });
  return session;
}

export function rekeySessionProjection(
  previousConversationId: string,
  nextConversationId: string,
  updates: SessionProjectionSeed = {},
): SessionProjection {
  if (previousConversationId === nextConversationId) {
    return createSessionProjection(nextConversationId, updates);
  }

  const existing = sessionProjections.get(previousConversationId);
  if (!existing) {
    return createSessionProjection(nextConversationId, updates);
  }

  sessionProjections.delete(previousConversationId);
  const session: SessionProjection = {
    ...existing,
    conversationId: nextConversationId,
    title: updates.title ?? existing.title,
    cwd: updates.cwd ?? existing.cwd,
    createdAt: updates.createdAt ?? existing.createdAt,
    updatedAt: updates.updatedAt ?? now(),
    agentId: updates.agentId ?? existing.agentId,
    status: updates.status ?? existing.status,
    error: updates.error ?? existing.error,
    pendingPermissions: updates.pendingPermissions ?? existing.pendingPermissions,
    messages: updates.messages ? [...updates.messages] : [...existing.messages],
  };
  sessionProjections.set(nextConversationId, session);
  return session;
}

export function deleteSessionProjection(conversationId: string): boolean {
  return sessionProjections.delete(conversationId);
}

function mergeStreamingMessage(
  messages: StreamMessage[],
  message: StreamMessage,
): StreamMessage[] {
  if (message.type === "stream_event") {
    return messages;
  }

  const nextMessages = [...messages];
  const messageId = "uuid" in message ? message.uuid : undefined;

  if (!messageId) {
    nextMessages.push(message);
    return nextMessages;
  }

  const existingIndex = nextMessages.findIndex(
    (existingMessage) => "uuid" in existingMessage && existingMessage.uuid === messageId,
  );

  if (existingIndex === -1) {
    nextMessages.push(message);
    return nextMessages;
  }

  if (message.type === "assistant" || message.type === "reasoning") {
    const existingMessage = nextMessages[existingIndex];
    const existingContent = "content" in existingMessage ? existingMessage.content : "";
    const nextContent = "content" in message ? message.content : "";
    nextMessages[existingIndex] = {
      ...message,
      content: existingContent + nextContent,
    } as StreamMessage;
    return nextMessages;
  }

  nextMessages[existingIndex] = message;
  return nextMessages;
}

export function appendSessionProjectionMessage(
  conversationId: string,
  message: StreamMessage,
): SessionProjection {
  const session = createSessionProjection(conversationId);
  session.messages = mergeStreamingMessage(session.messages, message);
  session.updatedAt = now();
  return session;
}

export function listSessionProjections(): SessionInfo[] {
  return [...sessionProjections.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((session) => ({
      id: session.conversationId,
      title: session.title,
      status: session.status,
      lettaConversationId: session.conversationId,
      cwd: session.cwd,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));
}

export function getSessionProjectionHistory(conversationId: string): StreamMessage[] {
  return sessionProjections.get(conversationId)?.messages.map((message) => ({ ...message })) ?? [];
}

export function getAllSessionProjections(): Map<string, SessionProjection> {
  return sessionProjections;
}

// Compatibility aliases for existing call sites. The canonical API is the
// projection/cache naming above.
export const createRuntimeSession = createSessionProjection;
export const getSession = getSessionProjection;
export const updateSession = updateSessionProjection;
export const rekeyRuntimeSession = rekeySessionProjection;
export const deleteSession = deleteSessionProjection;
export const appendSessionMessage = appendSessionProjectionMessage;
export const listRuntimeSessions = listSessionProjections;
export const getSessionHistory = getSessionProjectionHistory;
export const getAllSessions = getAllSessionProjections;
