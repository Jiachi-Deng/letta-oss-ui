/**
 * Simple in-memory runtime state for active sessions.
 * No persistence needed - Letta handles conversation/message storage.
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

export type RuntimeSession = {
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

// In-memory state for active sessions
const sessions = new Map<string, RuntimeSession>();

type RuntimeSessionSeed = {
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

export function createRuntimeSession(
  conversationId: string,
  seed: RuntimeSessionSeed = {},
): RuntimeSession {
  const existing = sessions.get(conversationId);
  if (existing) {
    return updateSession(conversationId, seed) ?? existing;
  }

  const timestamp = seed.createdAt ?? now();
  const session: RuntimeSession = {
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
  sessions.set(conversationId, session);
  return session;
}

export function getSession(conversationId: string): RuntimeSession | undefined {
  return sessions.get(conversationId);
}

export function updateSession(
  conversationId: string,
  updates: Partial<RuntimeSession>,
): RuntimeSession | undefined {
  const session = sessions.get(conversationId);
  if (!session) return undefined;
  Object.assign(session, {
    ...updates,
    updatedAt: updates.updatedAt ?? now(),
  });
  return session;
}

export function rekeyRuntimeSession(
  previousConversationId: string,
  nextConversationId: string,
  updates: RuntimeSessionSeed = {},
): RuntimeSession {
  if (previousConversationId === nextConversationId) {
    return createRuntimeSession(nextConversationId, updates);
  }

  const existing = sessions.get(previousConversationId);
  if (!existing) {
    return createRuntimeSession(nextConversationId, updates);
  }

  sessions.delete(previousConversationId);
  const session: RuntimeSession = {
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
  sessions.set(nextConversationId, session);
  return session;
}

export function deleteSession(conversationId: string): boolean {
  return sessions.delete(conversationId);
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

export function appendSessionMessage(
  conversationId: string,
  message: StreamMessage,
): RuntimeSession {
  const session = createRuntimeSession(conversationId);
  session.messages = mergeStreamingMessage(session.messages, message);
  session.updatedAt = now();
  return session;
}

export function listRuntimeSessions(): SessionInfo[] {
  return [...sessions.values()]
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

export function getSessionHistory(conversationId: string): StreamMessage[] {
  return sessions.get(conversationId)?.messages.map((message) => ({ ...message })) ?? [];
}

export function getAllSessions(): Map<string, RuntimeSession> {
  return sessions;
}
