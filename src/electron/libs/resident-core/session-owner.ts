import {
	createSession,
	resumeSession,
	type CanUseToolCallback,
	type SendMessage,
	type Session as LettaSession,
	type SDKMessage,
} from "@letta-ai/letta-code-sdk";
import type { Session as BotSession } from "@letta-ai/letta-code-sdk";
import type { BotConfig, StreamMsg } from "lettabot/core/types.js";
import type { PendingPermission } from "../runtime-state.js";
import { createComponentLogger, createTraceContext, createTurnId, type TraceContext } from "../trace.js";
import { createResidentCoreRuntimeHost } from "./runtime-host.js";
import type { ResidentCoreRuntimeHost } from "./runtime-host.js";
import { createResidentCoreSafetyCanUseTool } from "./safety.js";

type DesktopSessionRecord = {
	session: LettaSession;
	conversationId?: string;
	agentId?: string;
	generation: number;
	lastUsedAt: number;
};

type BotSessionRecord = {
	session: BotSession;
	conversationId?: string;
	agentId?: string;
	initialized: boolean;
	generation: number;
	lastUsedAt: number;
};

type NamespaceState<TSession> = {
	sessions: Map<string, { session: TSession; conversationId?: string; agentId?: string; generation: number; lastUsedAt: number }>;
	currentCanUseToolByKey: Map<string, CanUseToolCallback | undefined>;
};

type SharedIdentityState = {
	agentId: string | null;
};

export type ResidentCoreDesktopRunOptions = {
	prompt: string;
	session: {
		id: string;
		title: string;
		status: string;
		cwd?: string;
		pendingPermissions: Map<string, PendingPermission>;
	};
	resumeConversationId?: string;
	trace?: TraceContext;
	canUseTool?: CanUseToolCallback;
};

export type ResidentCoreBotRunOptions = {
	message: SendMessage;
	config: BotConfig;
	convKey?: string;
	trace?: TraceContext;
	canUseTool?: CanUseToolCallback;
};

const DEFAULT_CWD = process.cwd();
const DEBUG = process.env.DEBUG_RUNNER === "true";
const log = createComponentLogger("resident-core-session-owner");

function debug(msg: string, data?: Record<string, unknown>, context?: TraceContext): void {
	if (!DEBUG) return;
	log({
		level: "debug",
		message: msg,
		data,
		trace_id: context?.traceId,
		turn_id: context?.turnId,
		session_id: context?.sessionId,
	});
}

function toSessionOptions(
	config: BotConfig,
	canUseTool?: CanUseToolCallback,
	permissionMode: "default" | "bypassPermissions" = "bypassPermissions",
): NonNullable<Parameters<typeof createSession>[1]> {
	return {
		permissionMode,
		allowedTools: config.allowedTools,
		disallowedTools: [
			"TodoWrite",
			...(config.disallowedTools || []),
		],
		cwd: config.workingDir,
		...(config.memfs !== undefined ? { memfs: config.memfs } : {}),
		...(config.sleeptime ? { sleeptime: config.sleeptime } : {}),
		...(canUseTool ? { canUseTool } : {}),
	};
}

function createSessionLoggerContext(sessionId?: string): TraceContext {
	return createTraceContext({
		turnId: createTurnId(),
		sessionId,
	});
}

function normalizeConvKey(key?: string): string {
	return key && key.trim() ? key : "shared";
}

function isConversationMissingError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const lower = message.toLowerCase();
	return lower.includes("conversation") && (lower.includes("not found") || lower.includes("missing"));
}

function isApprovalConflictError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const lower = message.toLowerCase();
	return lower.includes("approval") && lower.includes("conflict");
}

export class ResidentCoreSessionOwner {
	private readonly runtimeHost: ResidentCoreRuntimeHost;
	private readonly desktopState: NamespaceState<LettaSession>;
	private readonly botState: NamespaceState<BotSession>;
	private readonly sharedIdentity: SharedIdentityState;

	constructor(options: { runtimeHost?: ResidentCoreRuntimeHost } = {}) {
		this.runtimeHost = options.runtimeHost ?? createResidentCoreRuntimeHost();
		this.desktopState = {
			sessions: new Map(),
			currentCanUseToolByKey: new Map(),
		};
		this.botState = {
			sessions: new Map(),
			currentCanUseToolByKey: new Map(),
		};
		this.sharedIdentity = {
			agentId: null,
		};
	}

	private getSharedAgentId(localAgentId?: string): string | undefined {
		return localAgentId || this.sharedIdentity.agentId || undefined;
	}

	private rememberSharedAgentId(agentId?: string): void {
		if (!agentId) return;
		if (!this.sharedIdentity.agentId) {
			this.sharedIdentity.agentId = agentId;
			return;
		}
		if (this.sharedIdentity.agentId !== agentId) {
			log({
				level: "warn",
				message: "shared agent identity already established with a different agentId",
				data: {
					existingAgentId: this.sharedIdentity.agentId,
					incomingAgentId: agentId,
				},
			});
		}
	}

	private prepareDesktopSessionOptions(canUseTool?: CanUseToolCallback) {
		const appConfigState = this.runtimeHost.getAppConfigState();
		return this.runtimeHost.prepareRuntimeConnection(appConfigState.config, createSessionLoggerContext())
			.then((runtimeConnection) => ({
				cwd: DEFAULT_CWD,
				permissionMode: "bypassPermissions" as const,
				canUseTool,
				model: runtimeConnection.modelHandle,
			}));
	}

	private async prepareBotSessionOptions(config: BotConfig, canUseTool?: CanUseToolCallback) {
		const appConfigState = this.runtimeHost.getAppConfigState();
		await this.runtimeHost.prepareRuntimeConnection(appConfigState.config, createSessionLoggerContext());
		return toSessionOptions(
			config,
			createResidentCoreSafetyCanUseTool(config.workingDir, canUseTool),
			"default",
		);
	}

	private getDesktopSessionRecord(key: string): DesktopSessionRecord | undefined {
		return this.desktopState.sessions.get(normalizeConvKey(key)) as DesktopSessionRecord | undefined;
	}

	private setDesktopSessionRecord(key: string, record: DesktopSessionRecord): void {
		this.desktopState.sessions.set(normalizeConvKey(key), record);
	}

	private getBotSessionRecord(key: string): BotSessionRecord | undefined {
		return this.botState.sessions.get(normalizeConvKey(key)) as BotSessionRecord | undefined;
	}

	private setBotSessionRecord(key: string, record: BotSessionRecord): void {
		this.botState.sessions.set(normalizeConvKey(key), record);
	}

	private async initializeBotSessionIfNeeded(session: BotSession, shouldInitialize: boolean): Promise<void> {
		if (!shouldInitialize) return;
		await session.initialize();
	}

	private closeDesktopSession(session: LettaSession): void {
		try {
			session.close();
		} catch {
			// best effort
		}
	}

	private closeBotSession(session: BotSession): void {
		try {
			session.close();
		} catch {
			// best effort
		}
	}

	async runDesktopSession(options: ResidentCoreDesktopRunOptions): Promise<{ session: LettaSession; stream: () => AsyncGenerator<SDKMessage> }> {
		const traceContext = options.trace ?? createTraceContext({ turnId: createTurnId() });
		const cachedKey = options.resumeConversationId || options.session.id;
		const normalizedKey = normalizeConvKey(cachedKey);
		const existing = this.getDesktopSessionRecord(normalizedKey);
		const sessionOptions = await this.prepareDesktopSessionOptions(options.canUseTool);
		const sharedAgentId = this.getSharedAgentId(existing?.agentId);
		let session: LettaSession;

		if (existing?.session) {
			session = existing.session;
		} else if (options.resumeConversationId) {
			session = resumeSession(options.resumeConversationId, sessionOptions);
		} else {
			session = createSession(sharedAgentId, sessionOptions);
		}

		debug("desktop session created", { key: normalizedKey }, traceContext);

		try {
			await session.send(options.prompt);
		} catch (error) {
			if (isConversationMissingError(error)) {
				this.desktopState.sessions.delete(normalizedKey);
				this.closeDesktopSession(session);
				session = createSession(this.getSharedAgentId(existing?.agentId), sessionOptions);
				await session.send(options.prompt);
			} else {
				this.desktopState.sessions.delete(normalizedKey);
				this.closeDesktopSession(session);
				if (isApprovalConflictError(error)) {
					log({
						level: "warn",
						message: "desktop session saw approval conflict",
						data: { key: normalizedKey },
					});
				}
				throw error;
			}
		}

		const nextRecord: DesktopSessionRecord = {
			session,
			conversationId: session.conversationId || existing?.conversationId,
			agentId: session.agentId || existing?.agentId,
			generation: (existing?.generation ?? 0) + 1,
			lastUsedAt: Date.now(),
		};
		this.rememberSharedAgentId(nextRecord.agentId);
		this.setDesktopSessionRecord(normalizedKey, nextRecord);

		return {
			session,
			stream: () => session.stream(),
		};
	}

	async warmDesktopSession(): Promise<void> {
		// Best-effort warmup to preserve the previous behavior of creating a reusable session eagerly.
		await this.runDesktopSession({
			prompt: "",
			session: {
				id: "shared",
				title: "shared",
				status: "running",
				pendingPermissions: new Map(),
			},
			trace: createSessionLoggerContext("desktop:warm"),
		}).then(({ session }) => {
			this.closeDesktopSession(session);
			this.desktopState.sessions.delete("shared");
		}).catch(() => {
			// Warmup is opportunistic.
		});
	}

	invalidateDesktopSession(key?: string): void {
		if (!key) {
			for (const record of this.desktopState.sessions.values()) {
				this.closeDesktopSession(record.session);
			}
			this.desktopState.sessions.clear();
			this.desktopState.currentCanUseToolByKey.clear();
			return;
		}

		const normalized = normalizeConvKey(key);
		const record = this.desktopState.sessions.get(normalized);
		if (!record) return;
		this.closeDesktopSession(record.session);
		this.desktopState.sessions.delete(normalized);
		this.desktopState.currentCanUseToolByKey.delete(normalized);
	}

	async runBotSession(options: ResidentCoreBotRunOptions): Promise<{ session: BotSession; stream: () => AsyncGenerator<StreamMsg> }> {
		const convKey = normalizeConvKey(options.convKey);
		const traceContext = options.trace ?? createSessionLoggerContext(convKey);
		const existing = this.getBotSessionRecord(convKey);
		const sessionOptions = await this.prepareBotSessionOptions(options.config, options.canUseTool);
		const sharedAgentId = this.getSharedAgentId(existing?.agentId);
		let session: BotSession;

		if (existing?.session) {
			session = existing.session;
		} else if (existing?.conversationId) {
			session = resumeSession(existing.conversationId, sessionOptions);
		} else if (existing?.agentId) {
			session = resumeSession(existing.agentId, sessionOptions);
		} else {
			session = createSession(sharedAgentId, sessionOptions);
		}

		try {
			await this.initializeBotSessionIfNeeded(session, !existing?.session || !existing.initialized);
			await session.send(options.message);
		} catch (error) {
			if (isConversationMissingError(error)) {
				this.botState.sessions.delete(convKey);
				this.closeBotSession(session);
				session = createSession(this.getSharedAgentId(existing?.agentId), sessionOptions);
				await session.send(options.message);
			} else {
				this.botState.sessions.delete(convKey);
				this.closeBotSession(session);
				if (isApprovalConflictError(error)) {
					log({
						level: "warn",
						message: "bot session saw approval conflict",
						data: { convKey },
					});
				}
				throw error;
			}
		}

		const nextRecord: BotSessionRecord = {
			session,
			conversationId: session.conversationId || existing?.conversationId,
			agentId: session.agentId || existing?.agentId,
			initialized: true,
			generation: (existing?.generation ?? 0) + 1,
			lastUsedAt: Date.now(),
		};
		this.rememberSharedAgentId(nextRecord.agentId);
		this.setBotSessionRecord(convKey, nextRecord);
		debug("bot session ready", { convKey }, traceContext);

		return {
			session,
			stream: () => session.stream() as AsyncGenerator<StreamMsg>,
		};
	}

	async ensureBotSessionForKey(options: Omit<ResidentCoreBotRunOptions, "message">): Promise<BotSession> {
		const convKey = normalizeConvKey(options.convKey);
		const existing = this.getBotSessionRecord(convKey);
		if (existing?.session) {
			if (!existing.initialized) {
				await this.initializeBotSessionIfNeeded(existing.session, true);
				this.setBotSessionRecord(convKey, {
					...existing,
					initialized: true,
				});
			}
			return existing.session;
		}

		const sessionOptions = await this.prepareBotSessionOptions(options.config, options.canUseTool);
		const sharedAgentId = this.getSharedAgentId(existing?.agentId);
		let session: BotSession;
		if (existing?.conversationId) {
			session = resumeSession(existing.conversationId, sessionOptions);
		} else if (existing?.agentId) {
			session = resumeSession(existing.agentId, sessionOptions);
		} else {
			session = createSession(sharedAgentId, sessionOptions);
		}

		await session.initialize();
		this.rememberSharedAgentId(session.agentId || existing?.agentId);
		this.setBotSessionRecord(convKey, {
			session,
			conversationId: session.conversationId || existing?.conversationId,
			agentId: session.agentId || existing?.agentId,
			initialized: true,
			generation: (existing?.generation ?? 0) + 1,
			lastUsedAt: Date.now(),
		});
		return session;
	}

	async warmBotSession(config: BotConfig): Promise<void> {
		try {
			await this.ensureBotSessionForKey({
				config,
				convKey: "shared",
				trace: createSessionLoggerContext("lettabot:warm"),
			});
		} catch {
			// warmup is opportunistic
		}
	}

	invalidateBotSession(key?: string): void {
		if (!key) {
			for (const record of this.botState.sessions.values()) {
				this.closeBotSession(record.session);
			}
			this.botState.sessions.clear();
			this.botState.currentCanUseToolByKey.clear();
			return;
		}

		const normalized = normalizeConvKey(key);
		const record = this.botState.sessions.get(normalized);
		if (!record) return;
		this.closeBotSession(record.session);
		this.botState.sessions.delete(normalized);
		this.botState.currentCanUseToolByKey.delete(normalized);
	}

	getBotSession(key: string): BotSession | undefined {
		return this.getBotSessionRecord(key)?.session;
	}

	getSharedAgentIdentity(): string | null {
		return this.sharedIdentity.agentId;
	}
}

export function createResidentCoreSessionOwner(options: { runtimeHost?: ResidentCoreRuntimeHost } = {}): ResidentCoreSessionOwner {
	return new ResidentCoreSessionOwner(options);
}
