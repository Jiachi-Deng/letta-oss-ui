import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session as LettaSession } from "@letta-ai/letta-code-sdk";
import {
  acquireReusableConversationSession,
  completeReusableConversationTurn,
  discardReusableConversationSession,
  discardAllReusableConversationSessions,
} from "./conversation-session-cache.js";

function createFakeSession(conversationId: string): LettaSession {
  const close = vi.fn();
  return {
    conversationId,
    close,
  } as unknown as LettaSession;
}

describe("conversation session cache", () => {
  afterEach(() => {
    discardAllReusableConversationSessions();
  });

  it("reuses only idle sessions with a matching signature and closes discarded sessions", () => {
    const signature = JSON.stringify({ baseUrl: "http://localhost:8283", modelHandle: "gpt-4o" });
    const otherSignature = JSON.stringify({ baseUrl: "http://localhost:8283", modelHandle: "gpt-4.1" });
    const session = createFakeSession("conv-123");
    const close = session.close as unknown as ReturnType<typeof vi.fn>;

    completeReusableConversationTurn(session, signature, true);

    const reused = acquireReusableConversationSession("conv-123", signature);
    expect(reused).toBe(session);

    completeReusableConversationTurn(session, signature, false);
    expect(close).toHaveBeenCalledTimes(1);

    completeReusableConversationTurn(session, signature, true);
    const mismatch = acquireReusableConversationSession("conv-123", otherSignature);
    expect(mismatch).toBeNull();
    expect(close).toHaveBeenCalledTimes(2);

    discardReusableConversationSession("conv-123");
  });
});
