import {
	createSession,
	createAgent,
	resumeSession,
	type CanUseToolCallback,
	type SendMessage,
	type Session as LettaSession,
	type SDKMessage,
} from "@letta-ai/letta-code-sdk";
import Letta from "@letta-ai/letta-client";
import type { Session as BotSession } from "@letta-ai/letta-code-sdk";
import type { BotConfig, StreamMsg } from "lettabot/core/types.js";
import type { PendingPermission } from "../runtime-state.js";
import { createComponentLogger, createTraceContext, createTurnId, type TraceContext } from "../trace.js";
import { createResidentCoreRuntimeHost } from "./runtime-host.js";
import type { ResidentCoreRuntimeHost, RuntimeConnectionInfo } from "./runtime-host.js";
import { createResidentCoreSafetyCanUseTool } from "./safety.js";
import { createResidentCoreStateStore, type ResidentCoreStateStore } from "./state-store.js";
import type { ResidentCoreAgentEntry, ResidentCoreAgentMutationResult, ResidentCoreAgentRecord } from "../../types.js";
import {
	RC_DESKTOP_RUN_001,
	RC_DESKTOP_RUN_002,
	RC_DESKTOP_RUN_003,
	RC_DESKTOP_RUN_004,
	RC_DESKTOP_RUN_005,
	RC_BOT_RUN_001,
	RC_BOT_RUN_002,
	RC_BOT_RUN_003,
	RC_BOT_RUN_004,
	RC_BOT_RUN_005,
	RC_BOT_ENSURE_001,
	RC_BOT_ENSURE_002,
	RC_BOT_ENSURE_003,
} from "../../../shared/decision-ids.js";
import {
	E_RESIDENT_CORE_DESKTOP_RUN_FAILED,
	E_RESIDENT_CORE_BOT_RUN_FAILED,
	E_RESIDENT_CORE_BOT_ENSURE_FAILED,
} from "../../../shared/error-codes.js";

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

function createResidentCoreClient(connection: RuntimeConnectionInfo): Letta {
	return new Letta({
		apiKey: connection.apiKey ?? "",
		baseURL: connection.baseUrl,
		defaultHeaders: {
			"X-Letta-Source": "letta-desktop-resident-core",
		},
	});
}

function isAgentMissingError(error: unknown): boolean {
	const status = typeof error === "object" && error !== null && "status" in error
		? (error as { status?: unknown }).status
		: undefined;
	if (status === 404) return true;

	const message = error instanceof Error ? error.message : String(error);
	const lower = message.toLowerCase();
	return lower.includes("not found") || lower.includes("404");
}

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
const DESKTOP_INIT_RETRY_DELAYS_MS = [150, 400];
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

function traceInfo(context: TraceContext | undefined, message: string, decisionId: string, data?: Record<string, unknown>): void {
	log({
		level: "info",
		message,
		decision_id: decisionId as never,
		data,
		trace_id: context?.traceId,
		turn_id: context?.turnId,
		session_id: context?.sessionId,
	});
}

function traceWarn(context: TraceContext | undefined, message: string, decisionId: string, data?: Record<string, unknown>): void {
	log({
		level: "warn",
		message,
		decision_id: decisionId as never,
		data,
		trace_id: context?.traceId,
		turn_id: context?.turnId,
		session_id: context?.sessionId,
	});
}

function traceError(
	context: TraceContext | undefined,
	message: string,
	decisionId: string,
	errorCode: string,
	data?: Record<string, unknown>,
): void {
	log({
		level: "error",
		message,
		decision_id: decisionId as never,
		error_code: errorCode as never,
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

function isInitMessageMissingError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.toLowerCase().includes("no init message received");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ResidentCoreSessionOwner {
	private readonly runtimeHost: ResidentCoreRuntimeHost;
	private readonly stateStore: ResidentCoreStateStore;
	private readonly desktopState: NamespaceState<LettaSession>;
	private readonly botState: NamespaceState<BotSession>;
	private readonly sharedIdentity: SharedIdentityState;

	constructor(options: { runtimeHost?: ResidentCoreRuntimeHost } = {}) {
		this.runtimeHost = options.runtimeHost ?? createResidentCoreRuntimeHost();
		this.stateStore = createResidentCoreStateStore();
		this.desktopState = {
			sessions: new Map(),
			currentCanUseToolByKey: new Map(),
		};
		this.botState = {
			sessions: new Map(),
			currentCanUseToolByKey: new Map(),
		};
		this.sharedIdentity = {
			agentId: this.stateStore.getActiveAgentId(),
		};
	}

	private getSharedAgentId(localAgentId?: string): string | undefined {
		return localAgentId || this.sharedIdentity.agentId || this.stateStore.getActiveAgentId() || undefined;
	}

	private rememberSharedAgentId(agentId?: string): void {
		if (!agentId) return;
		if (!this.stateStore.rememberActiveAgent(agentId)) {
			if (this.stateStore.getActiveAgentId() && this.stateStore.getActiveAgentId() !== agentId) {
				log({
					level: "warn",
					message: "shared agent identity already established with a different agentId",
					data: {
						existingAgentId: this.stateStore.getActiveAgentId(),
						incomingAgentId: agentId,
					},
				});
			}
			return;
		}
		if (!this.sharedIdentity.agentId || this.sharedIdentity.agentId === agentId) {
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

	private clearSessionCaches(): void {
		this.invalidateDesktopSession();
		this.invalidateBotSession();
	}

	private buildAgentMutationResult(
		agentKey: string,
		success: boolean,
		error?: string,
	): ResidentCoreAgentMutationResult {
		return {
			success,
			agentKey,
			activeAgentKey: this.getActiveAgentKey(),
			agent: this.getActiveAgentRecord(),
			agents: this.listKnownAgents(),
			...(error ? { error } : {}),
		};
	}

	getActiveAgentKey(): string {
		return this.stateStore.getActiveAgentKey();
	}

	getActiveAgentRecord(): ResidentCoreAgentRecord | null {
		return this.stateStore.getActiveAgentRecord();
	}

	listKnownAgents(): ResidentCoreAgentEntry[] {
		return this.stateStore.listAgents();
	}

	switchActiveAgent(agentKey: string): boolean {
		const switched = this.stateStore.setActiveAgentKey(agentKey);
		if (!switched) return false;

		this.sharedIdentity.agentId = this.stateStore.getActiveAgentId();
		this.clearSessionCaches();
		return true;
	}

	private async prepareAgentAdminContext(trace?: TraceContext): Promise<{
		connection: RuntimeConnectionInfo;
		client: Letta;
	}> {
		const appConfigState = this.runtimeHost.getAppConfigState();
		const context = trace ?? createSessionLoggerContext();
		const connection = await this.runtimeHost.prepareRuntimeConnection(appConfigState.config, context);
		return {
			connection,
			client: createResidentCoreClient(connection),
		};
	}

	async createManagedAgent(options: { name?: string; trace?: TraceContext } = {}): Promise<ResidentCoreAgentMutationResult> {
		const traceContext = options.trace ?? createSessionLoggerContext();
		let createdAgentKey: string | undefined;
		try {
			const { connection, client } = await this.prepareAgentAdminContext(traceContext);
			const previousActiveKey = this.getActiveAgentKey();
			const createOptions = connection.modelHandle
				? { model: connection.modelHandle }
				: {};
			const agentId = await createAgent(createOptions);
			createdAgentKey = agentId;
			let createdName = options.name?.trim();

			if (createdName) {
				try {
					await client.agents.update(agentId, { name: createdName });
				} catch (error) {
					try {
						await client.agents.delete(agentId);
					} catch {
						// best effort rollback
					}
					throw error;
				}
			}

			const record = this.stateStore.upsertAgentRecord(
				agentId,
				{
					agentId,
					lastUsedAt: new Date().toISOString(),
					...(createdName ? { name: createdName } : {}),
					conversationMode: "shared",
				},
				false,
			);
			if (!record) {
				throw new Error("Failed to persist created agent in the resident core registry.");
			}

			const currentActiveKey = this.getActiveAgentKey();
			if (currentActiveKey !== agentId) {
				if (!this.switchActiveAgent(agentId)) {
					this.stateStore.deleteAgentRecord(agentId);
					try {
						await client.agents.delete(agentId);
					} catch {
						// best effort rollback
					}
					throw new Error("Failed to activate the created agent.");
				}
			} else if (previousActiveKey !== currentActiveKey) {
				this.sharedIdentity.agentId = this.stateStore.getActiveAgentId();
			}
			this.sharedIdentity.agentId = this.stateStore.getActiveAgentId();

			return {
				success: true,
				agentKey: agentId,
				activeAgentKey: this.getActiveAgentKey(),
				agent: this.getActiveAgentRecord(),
				agents: this.listKnownAgents(),
			};
		} catch (error) {
			return this.buildAgentMutationResult(
				createdAgentKey ?? this.getActiveAgentKey(),
				false,
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	async renameManagedAgent(options: { agentKey: string; name: string; trace?: TraceContext }): Promise<ResidentCoreAgentMutationResult> {
		const traceContext = options.trace ?? createSessionLoggerContext(options.agentKey);
		const agentKey = options.agentKey.trim();
		const nextName = options.name.trim();
		const existing = this.stateStore.getAgentRecord(agentKey);
		if (!existing) {
			return this.buildAgentMutationResult(agentKey, false, `Unknown agent key: ${agentKey}`);
		}

		try {
			const { client } = await this.prepareAgentAdminContext(traceContext);
			await client.agents.update(existing.agentId, { name: nextName });
			const updated = this.stateStore.upsertAgentRecord(
				agentKey,
				{
					agentId: existing.agentId,
					name: nextName,
					lastUsedAt: new Date().toISOString(),
					...(existing.conversationMode ? { conversationMode: existing.conversationMode } : {}),
					...(existing.channels ? { channels: { ...existing.channels } } : {}),
				},
				false,
			);
			if (!updated) {
				throw new Error("Failed to persist renamed agent in the resident core registry.");
			}

			return {
				success: true,
				agentKey,
				activeAgentKey: this.getActiveAgentKey(),
				agent: this.getActiveAgentRecord(),
				agents: this.listKnownAgents(),
			};
		} catch (error) {
			return this.buildAgentMutationResult(
				agentKey,
				false,
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	async deleteManagedAgent(options: { agentKey: string; trace?: TraceContext }): Promise<ResidentCoreAgentMutationResult> {
		const traceContext = options.trace ?? createSessionLoggerContext(options.agentKey);
		const agentKey = options.agentKey.trim();
		const existing = this.stateStore.getAgentRecord(agentKey);
		if (!existing) {
			return this.buildAgentMutationResult(agentKey, false, `Unknown agent key: ${agentKey}`);
		}

		const previousActiveKey = this.getActiveAgentKey();

		try {
			const { client } = await this.prepareAgentAdminContext(traceContext);
			try {
				await client.agents.delete(existing.agentId);
			} catch (error) {
				if (!isAgentMissingError(error)) {
					throw error;
				}
			}

			const removed = this.stateStore.deleteAgentRecord(agentKey);
			if (!removed) {
				throw new Error("Failed to remove agent from the resident core registry.");
			}

			if (previousActiveKey !== this.getActiveAgentKey()) {
				this.clearSessionCaches();
			}

			return {
				success: true,
				agentKey,
				activeAgentKey: this.getActiveAgentKey(),
				agent: this.getActiveAgentRecord(),
				agents: this.listKnownAgents(),
			};
		} catch (error) {
			return this.buildAgentMutationResult(
				agentKey,
				false,
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	private prepareDesktopSessionOptions(cwd?: string, canUseTool?: CanUseToolCallback) {
		const appConfigState = this.runtimeHost.getAppConfigState();
		return this.runtimeHost.prepareRuntimeConnection(appConfigState.config, createSessionLoggerContext())
			.then((runtimeConnection) => ({
				cwd: cwd || DEFAULT_CWD,
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
		const sessionOptions = await this.prepareDesktopSessionOptions(options.session.cwd, options.canUseTool);
		const sharedAgentId = this.getSharedAgentId(existing?.agentId);
		let session: LettaSession;
		traceInfo(traceContext, "Resident Core desktop session run entered", RC_DESKTOP_RUN_001, {
			key: normalizedKey,
			hasExistingConversation: Boolean(existing?.conversationId),
			hasResumeConversationId: Boolean(options.resumeConversationId),
			cliPath: process.env.LETTA_CLI_PATH,
			baseUrl: process.env.LETTA_BASE_URL,
		});

		if (existing?.conversationId) {
			session = resumeSession(existing.conversationId, sessionOptions);
		} else if (options.resumeConversationId) {
			session = resumeSession(options.resumeConversationId, sessionOptions);
		} else {
			session = createSession(sharedAgentId, sessionOptions);
		}

		debug("desktop session created", { key: normalizedKey }, traceContext);

		try {
			await session.send(options.prompt);
		} catch (initialError) {
			let error = initialError;
			if (isConversationMissingError(error)) {
				traceWarn(traceContext, "Resident Core desktop session conversation missing; recreating session", RC_DESKTOP_RUN_002, {
					key: normalizedKey,
					error: error instanceof Error ? error.message : String(error),
				});
				this.desktopState.sessions.delete(normalizedKey);
				this.closeDesktopSession(session);
				session = createSession(this.getSharedAgentId(existing?.agentId), sessionOptions);
				await session.send(options.prompt);
			} else if (isInitMessageMissingError(error)) {
				this.desktopState.sessions.delete(normalizedKey);
				this.closeDesktopSession(session);

				let recovered = false;
				for (let attemptIndex = 0; attemptIndex < DESKTOP_INIT_RETRY_DELAYS_MS.length; attemptIndex += 1) {
					const delayMs = DESKTOP_INIT_RETRY_DELAYS_MS[attemptIndex];
					traceWarn(traceContext, "Resident Core desktop session init missing; retrying with a fresh session", RC_DESKTOP_RUN_002, {
						key: normalizedKey,
						cwd: options.session.cwd || DEFAULT_CWD,
						attempt: attemptIndex + 1,
						delayMs,
						cliPath: process.env.LETTA_CLI_PATH,
						baseUrl: process.env.LETTA_BASE_URL,
						error: error instanceof Error ? error.message : String(error),
					});
					await sleep(delayMs);
					const refreshedSessionOptions = await this.prepareDesktopSessionOptions(options.session.cwd, options.canUseTool);
					session = createSession(this.getSharedAgentId(existing?.agentId), refreshedSessionOptions);
					try {
						await session.send(options.prompt);
						recovered = true;
						break;
					} catch (retryError) {
						error = retryError;
						this.closeDesktopSession(session);
						if (!isInitMessageMissingError(retryError)) {
							break;
						}
					}
				}

				if (!recovered) {
					if (isApprovalConflictError(error)) {
						traceWarn(traceContext, "Resident Core desktop session saw approval conflict", RC_DESKTOP_RUN_003, {
							key: normalizedKey,
							error: error instanceof Error ? error.message : String(error),
						});
					}
					traceError(traceContext, "Resident Core desktop session run failed", RC_DESKTOP_RUN_004, E_RESIDENT_CORE_DESKTOP_RUN_FAILED, {
						key: normalizedKey,
						cwd: options.session.cwd || DEFAULT_CWD,
						cliPath: process.env.LETTA_CLI_PATH,
						baseUrl: process.env.LETTA_BASE_URL,
						error: error instanceof Error ? error.message : String(error),
					});
					throw error;
				}
			} else {
				this.desktopState.sessions.delete(normalizedKey);
				this.closeDesktopSession(session);
				if (isApprovalConflictError(error)) {
					traceWarn(traceContext, "Resident Core desktop session saw approval conflict", RC_DESKTOP_RUN_003, {
						key: normalizedKey,
						error: error instanceof Error ? error.message : String(error),
					});
				}
				traceError(traceContext, "Resident Core desktop session run failed", RC_DESKTOP_RUN_004, E_RESIDENT_CORE_DESKTOP_RUN_FAILED, {
					key: normalizedKey,
					cliPath: process.env.LETTA_CLI_PATH,
					baseUrl: process.env.LETTA_BASE_URL,
					error: error instanceof Error ? error.message : String(error),
				});
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
		traceInfo(
			{
				...traceContext,
				sessionId: nextRecord.conversationId ?? traceContext.sessionId,
			},
			"Resident Core desktop session run completed",
			RC_DESKTOP_RUN_005,
			{
				key: normalizedKey,
				conversationId: nextRecord.conversationId,
				agentId: nextRecord.agentId,
			},
		);

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
		traceInfo(traceContext, "Resident Core bot session run entered", RC_BOT_RUN_001, {
			convKey,
			hasExistingSession: Boolean(existing?.session),
			hasExistingConversation: Boolean(existing?.conversationId),
		});

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
				traceWarn(traceContext, "Resident Core bot session conversation missing; recreating session", RC_BOT_RUN_002, {
					convKey,
					error: error instanceof Error ? error.message : String(error),
				});
				this.botState.sessions.delete(convKey);
				this.closeBotSession(session);
				session = createSession(this.getSharedAgentId(existing?.agentId), sessionOptions);
				await session.send(options.message);
			} else {
				this.botState.sessions.delete(convKey);
				this.closeBotSession(session);
				if (isApprovalConflictError(error)) {
					traceWarn(traceContext, "Resident Core bot session saw approval conflict", RC_BOT_RUN_003, {
						convKey,
						error: error instanceof Error ? error.message : String(error),
					});
				}
				traceError(traceContext, "Resident Core bot session run failed", RC_BOT_RUN_004, E_RESIDENT_CORE_BOT_RUN_FAILED, {
					convKey,
					error: error instanceof Error ? error.message : String(error),
				});
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
		traceInfo(
			{
				...traceContext,
				sessionId: nextRecord.conversationId ?? traceContext.sessionId,
			},
			"Resident Core bot session run completed",
			RC_BOT_RUN_005,
			{
				convKey,
				conversationId: nextRecord.conversationId,
				agentId: nextRecord.agentId,
			},
		);

		return {
			session,
			stream: () => session.stream() as AsyncGenerator<StreamMsg>,
		};
	}

	async ensureBotSessionForKey(options: Omit<ResidentCoreBotRunOptions, "message">): Promise<BotSession> {
		const convKey = normalizeConvKey(options.convKey);
		const traceContext = options.trace ?? createSessionLoggerContext(convKey);
		traceInfo(traceContext, "Resident Core ensure bot session entered", RC_BOT_ENSURE_001, {
			convKey,
		});
		const existing = this.getBotSessionRecord(convKey);
		if (existing?.session) {
			if (!existing.initialized) {
				await this.initializeBotSessionIfNeeded(existing.session, true);
				this.setBotSessionRecord(convKey, {
					...existing,
					initialized: true,
				});
			}
			traceInfo(
				{
					...traceContext,
					sessionId: existing.conversationId ?? traceContext.sessionId,
				},
				"Resident Core ensure bot session reused existing session",
				RC_BOT_ENSURE_002,
				{
					convKey,
					conversationId: existing.conversationId,
					agentId: existing.agentId,
				},
			);
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

		try {
			await session.initialize();
		} catch (error) {
			traceError(traceContext, "Resident Core ensure bot session failed", RC_BOT_ENSURE_003, E_RESIDENT_CORE_BOT_ENSURE_FAILED, {
				convKey,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
		this.rememberSharedAgentId(session.agentId || existing?.agentId);
		const record = {
			session,
			conversationId: session.conversationId || existing?.conversationId,
			agentId: session.agentId || existing?.agentId,
			initialized: true,
			generation: (existing?.generation ?? 0) + 1,
			lastUsedAt: Date.now(),
		};
		this.setBotSessionRecord(convKey, record);
		traceInfo(
			{
				...traceContext,
				sessionId: record.conversationId ?? traceContext.sessionId,
			},
			"Resident Core ensure bot session created session",
			RC_BOT_ENSURE_002,
			{
				convKey,
				conversationId: record.conversationId,
				agentId: record.agentId,
			},
		);
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
		return this.sharedIdentity.agentId || this.stateStore.getActiveAgentId();
	}
}

export function createResidentCoreSessionOwner(options: { runtimeHost?: ResidentCoreRuntimeHost } = {}): ResidentCoreSessionOwner {
	return new ResidentCoreSessionOwner(options);
}
