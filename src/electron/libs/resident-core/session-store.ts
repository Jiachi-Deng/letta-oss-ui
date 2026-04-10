import type { PendingPermission } from "../runtime-state.js";
import type {
  SessionInfo,
  SessionStatus,
  StreamMessage,
} from "../../types.js";
import {
  appendSessionProjectionMessage,
  clearAllSessionProjections,
  createSessionProjection,
  deleteSessionProjection,
  getSessionProjection,
  getSessionProjectionHistory,
  listSessionProjections,
  rekeySessionProjection,
  updateSessionProjection,
  type SessionProjection,
} from "../runtime-state.js";

export type SessionProjectionSeed = {
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

export class ResidentCoreSessionStore {
  list(): SessionInfo[] {
    return listSessionProjections();
  }

  get(sessionId: string): SessionProjection | undefined {
    return getSessionProjection(sessionId);
  }

  history(sessionId: string): StreamMessage[] {
    return getSessionProjectionHistory(sessionId);
  }

  ensure(sessionId: string, seed: SessionProjectionSeed = {}): SessionProjection {
    return createSessionProjection(sessionId, seed);
  }

  update(sessionId: string, updates: Partial<SessionProjection>): SessionProjection | undefined {
    return updateSessionProjection(sessionId, updates);
  }

  rekey(
    previousSessionId: string,
    nextSessionId: string,
    seed: SessionProjectionSeed = {},
  ): SessionProjection {
    return rekeySessionProjection(previousSessionId, nextSessionId, seed);
  }

  delete(sessionId: string): boolean {
    return deleteSessionProjection(sessionId);
  }

  appendUserPrompt(sessionId: string, prompt: string): SessionProjection {
    return appendSessionProjectionMessage(sessionId, {
      type: "user_prompt",
      prompt,
    });
  }

  appendMessage(sessionId: string, message: StreamMessage): SessionProjection {
    return appendSessionProjectionMessage(sessionId, message);
  }

  clear(): void {
    clearAllSessionProjections();
  }
}

export function createResidentCoreSessionStore(): ResidentCoreSessionStore {
  return new ResidentCoreSessionStore();
}
