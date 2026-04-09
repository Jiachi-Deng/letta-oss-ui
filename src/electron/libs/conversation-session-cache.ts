import type { Session as LettaSession } from "@letta-ai/letta-code-sdk";

// Sequential reuse only: one idle session per conversation can be cached and
// reused for the next turn, but an active conversation turn is never shared.
type CachedConversationSession = {
  session: LettaSession;
  signature: string;
};

const idleSessions = new Map<string, CachedConversationSession>();
const activeConversationIds = new Set<string>();

function ensureTurnNotActive(conversationId: string): void {
  if (activeConversationIds.has(conversationId)) {
    throw new Error(`Conversation ${conversationId} already has an active reusable session.`);
  }
}

function closeQuietly(session: LettaSession): void {
  try {
    session.close();
  } catch {
    // Best-effort cleanup.
  }
}

export function isConversationTurnActive(conversationId: string): boolean {
  return activeConversationIds.has(conversationId);
}

export function acquireReusableConversationSession(
  conversationId: string,
  signature: string,
): LettaSession | null {
  ensureTurnNotActive(conversationId);

  const cached = idleSessions.get(conversationId);
  if (!cached) {
    return null;
  }

  if (cached.signature !== signature) {
    idleSessions.delete(conversationId);
    closeQuietly(cached.session);
    return null;
  }

  idleSessions.delete(conversationId);
  activeConversationIds.add(conversationId);
  return cached.session;
}

export function beginReusableConversationTurn(conversationId: string): void {
  ensureTurnNotActive(conversationId);
  activeConversationIds.add(conversationId);
}

export function completeReusableConversationTurn(
  session: LettaSession,
  signature: string,
  keepAlive: boolean,
): void {
  const conversationId = session.conversationId;
  if (!conversationId) {
    closeQuietly(session);
    return;
  }

  if (keepAlive) {
    idleSessions.set(conversationId, { session, signature });
  } else {
    idleSessions.delete(conversationId);
    closeQuietly(session);
  }

  activeConversationIds.delete(conversationId);
}

export function discardReusableConversationSession(conversationId: string): void {
  const cached = idleSessions.get(conversationId);
  if (!cached) {
    return;
  }

  idleSessions.delete(conversationId);
  closeQuietly(cached.session);
}

export function discardAllReusableConversationSessions(): void {
  for (const cached of idleSessions.values()) {
    closeQuietly(cached.session);
  }
  idleSessions.clear();
}
