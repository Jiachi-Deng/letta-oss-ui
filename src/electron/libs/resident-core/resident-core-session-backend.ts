import type { CanUseToolCallback, SendMessage, Session } from "@letta-ai/letta-code-sdk";
import type { SessionBackend, SessionRunOptions, SessionRunResult } from "lettabot/core/interfaces.js";
import type { BotConfig } from "lettabot/core/types.js";
import { createResidentCoreSessionOwner, type ResidentCoreSessionOwner } from "./session-owner.js";

export type ResidentCoreSessionBackendOptions = {
	owner?: ResidentCoreSessionOwner;
	config: BotConfig;
};

export class ResidentCoreSessionBackend {
	private readonly owner: ResidentCoreSessionOwner;

	constructor(private readonly options: ResidentCoreSessionBackendOptions) {
		this.owner = options.owner ?? createResidentCoreSessionOwner();
	}

	warmSession(): Promise<void> {
		return this.owner.warmBotSession(this.options.config);
	}

	invalidateSession(key?: string): void {
		this.owner.invalidateBotSession(key);
	}

	getSession(key: string): Session | undefined {
		return this.owner.getBotSession(key) as Session | undefined;
	}

	async ensureSessionForKey(key: string, _bootstrapRetried = false): Promise<Session> {
		return this.owner.ensureBotSessionForKey({
			config: this.options.config,
			convKey: key,
		}) as Promise<Session>;
	}

	persistSessionState(_session: Session, _convKey?: string): void {
		// The Resident Core owner is authoritative for session state.
	}

	runSession(message: SendMessage, options: SessionRunOptions = {}): Promise<SessionRunResult> {
		return this.owner.runBotSession({
			message,
			config: this.options.config,
			canUseTool: options.canUseTool as CanUseToolCallback | undefined,
			convKey: options.convKey,
		}) as unknown as Promise<SessionRunResult>;
	}

	syncTodoToolCall(): void {
		// Not needed for Resident Core backed sessions.
	}
}

export function createResidentCoreSessionBackend(options: ResidentCoreSessionBackendOptions): SessionBackend {
	return new ResidentCoreSessionBackend(options) as unknown as SessionBackend;
}
