import { app } from "electron";
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
import {
	hydrateResidentCoreSessionProjections,
	snapshotResidentCoreSessionProjections,
	writeResidentCoreSessionProjectionState,
} from "./session-projection-persistence.js";

type PersistencePriority = "content" | "structural";

const PERSISTENCE_DELAYS_MS: Record<PersistencePriority, number> = {
  content: 250,
  structural: 50,
};

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
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimerDeadline: number | null = null;
  private persistQueued = false;
  private persistDrainPromise: Promise<void> | null = null;

  constructor(private readonly userDataPath = app.getPath("userData")) {
    hydrateResidentCoreSessionProjections(this.userDataPath);
  }

  private schedulePersistence(priority: PersistencePriority): void {
    this.persistQueued = true;
    if (this.persistDrainPromise) return;

    const nextDelay = PERSISTENCE_DELAYS_MS[priority];
    const nextDeadline = Date.now() + nextDelay;

    if (this.persistTimer && this.persistTimerDeadline !== null) {
      if (this.persistTimerDeadline <= nextDeadline) {
        return;
      }
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      this.persistTimerDeadline = null;
    }

    this.persistTimerDeadline = nextDeadline;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistTimerDeadline = null;
      void this.flushPersistence();
    }, nextDelay);

    if (typeof this.persistTimer.unref === "function") {
      this.persistTimer.unref();
    }
  }

  async flushPersistence(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    if (this.persistDrainPromise) {
      await this.persistDrainPromise;
      return;
    }

    if (!this.persistQueued) return;

    this.persistDrainPromise = this.drainPersistenceQueue();

    try {
      await this.persistDrainPromise;
    } finally {
      this.persistDrainPromise = null;
    }
  }

  private async drainPersistenceQueue(): Promise<void> {
    while (this.persistQueued) {
      this.persistQueued = false;
      await writeResidentCoreSessionProjectionState(this.userDataPath, snapshotResidentCoreSessionProjections());
    }
  }

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
    const session = createSessionProjection(sessionId, seed);
    this.schedulePersistence("structural");
    return session;
  }

  update(sessionId: string, updates: Partial<SessionProjection>): SessionProjection | undefined {
    const session = updateSessionProjection(sessionId, updates);
    if (session) {
      this.schedulePersistence("structural");
    }
    return session;
  }

  rekey(
    previousSessionId: string,
    nextSessionId: string,
    seed: SessionProjectionSeed = {},
  ): SessionProjection {
    const session = rekeySessionProjection(previousSessionId, nextSessionId, seed);
    this.schedulePersistence("structural");
    return session;
  }

  delete(sessionId: string): boolean {
    const deleted = deleteSessionProjection(sessionId);
    if (deleted) {
      this.schedulePersistence("structural");
    }
    return deleted;
  }

  appendUserPrompt(sessionId: string, prompt: string): SessionProjection {
    const session = appendSessionProjectionMessage(sessionId, {
      type: "user_prompt",
      prompt,
    });
    this.schedulePersistence("content");
    return session;
  }

  appendMessage(sessionId: string, message: StreamMessage): SessionProjection {
    const session = appendSessionProjectionMessage(sessionId, message);
    if (message.type !== "stream_event") {
      this.schedulePersistence("content");
    }
    return session;
  }

  clear(): void {
    clearAllSessionProjections();
    this.schedulePersistence("structural");
  }

  sanitizeForRestart(): void {
    let changed = false;

    for (const session of listSessionProjections()) {
      const projection = getSessionProjection(session.id);
      if (!projection) continue;

      if (projection.status === "running") {
        projection.status = "idle";
        projection.error = undefined;
        projection.updatedAt = Date.now();
        changed = true;
      }

      if (projection.pendingPermissions.size > 0) {
        projection.pendingPermissions.clear();
        projection.updatedAt = Date.now();
        changed = true;
      }
    }

    if (changed) {
      this.schedulePersistence("structural");
    }
  }
}

export function createResidentCoreSessionStore(userDataPath = app.getPath("userData")): ResidentCoreSessionStore {
	return new ResidentCoreSessionStore(userDataPath);
}
