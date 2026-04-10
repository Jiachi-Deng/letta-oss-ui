import { resolve } from "node:path";
import { app } from "electron";
import { createChannelsForAgent } from "lettabot/channels/factory.js";
import { LettaBot } from "lettabot/core/bot.js";
import type { ChannelAdapter } from "lettabot/channels/types.js";
import type { SessionBackend } from "lettabot/core/interfaces.js";
import type { BotConfig } from "lettabot/core/types.js";
import type { AgentConfig } from "lettabot/config/types.js";
import { createComponentLogger } from "../trace.js";
import type { ResidentCoreTelegramStartupConfig } from "../config.js";
import { createResidentCoreSessionBackend } from "./resident-core-session-backend.js";

const log = createComponentLogger("resident-core-lettabot");
const DEFAULT_ATTACHMENTS_MAX_BYTES = 20 * 1024 * 1024;

function maskTelegramToken(token?: string | null): string | null {
	const trimmedToken = token?.trim();
	if (!trimmedToken) return null;
	return `***${trimmedToken.slice(-4)}`;
}

function summarizeTelegramConfig(telegram: ResidentCoreTelegramStartupConfig | null): Record<string, unknown> {
	return {
		hasToken: Boolean(telegram?.token?.trim()),
		tokenTail: maskTelegramToken(telegram?.token),
		dmPolicy: telegram?.dmPolicy ?? null,
		streaming: telegram?.streaming ?? null,
		workingDir: telegram?.workingDir ?? null,
	};
}

function serializeError(error: unknown): Record<string, unknown> {
	return {
		error: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
	};
}

export type ResidentCoreLettaBotHandle = {
	registerChannel(adapter: ChannelAdapter): void;
	start(): Promise<void>;
	stop(): Promise<void>;
	warmSession(): Promise<void>;
};

export type ResidentCoreLettaBotFactory = (
	config: BotConfig,
	backend: SessionBackend,
) => ResidentCoreLettaBotHandle;

export type ResidentCoreLettaBotHostOptions = {
	config: BotConfig;
	backend?: SessionBackend;
	telegram?: ResidentCoreTelegramStartupConfig | null;
	createBot?: ResidentCoreLettaBotFactory;
};

function createDefaultBotConfig(baseDir: string): BotConfig {
	return {
		workingDir: resolve(baseDir, "lettabot"),
		allowedTools: [],
		conversationMode: "shared",
		reuseSession: true,
		agentName: "ResidentCoreLettaBot",
	};
}

function normalizeTelegramConfig(telegram?: ResidentCoreTelegramStartupConfig | null): ResidentCoreTelegramStartupConfig | null {
	if (!telegram?.token?.trim()) return null;
	return {
		token: telegram.token.trim(),
		dmPolicy: telegram.dmPolicy ?? "open",
		streaming: telegram.streaming ?? true,
		workingDir: telegram.workingDir?.trim() || undefined,
	};
}

function createTelegramAgentConfig(
	botConfig: BotConfig,
	telegram: ResidentCoreTelegramStartupConfig,
): AgentConfig {
	return {
		name: botConfig.agentName ?? "ResidentCoreLettaBot",
		workingDir: botConfig.workingDir,
		channels: {
			telegram: {
				enabled: true,
				token: telegram.token!,
				dmPolicy: telegram.dmPolicy ?? "open",
				streaming: telegram.streaming ?? true,
			},
		},
		conversations: {
			mode: botConfig.conversationMode,
			reuseSession: botConfig.reuseSession,
		},
		features: {
			logging: botConfig.logging,
		},
	} satisfies AgentConfig;
}

function createDefaultBackend(options: ResidentCoreLettaBotHostOptions): SessionBackend {
	return createResidentCoreSessionBackend({
		config: options.config,
	}) as unknown as SessionBackend;
}

export class ResidentCoreLettaBotHost {
	private backend: SessionBackend | null = null;
	private bot: ResidentCoreLettaBotHandle | null = null;
	private started = false;

	constructor(private readonly options: ResidentCoreLettaBotHostOptions) {}

	async start(): Promise<void> {
		if (this.started) return;
		const telegram = normalizeTelegramConfig(this.options.telegram);
		log({
			level: "info",
			message: "Resident Core LettaBot host start entered",
			data: {
				telegram: summarizeTelegramConfig(telegram),
			},
		});
		if (!telegram) {
			log({
				level: "info",
				message: "Resident Core LettaBot host idle: Telegram is not configured",
			});
			return;
		}

		this.started = true;
		try {
			const backend = this.options.backend ?? createDefaultBackend(this.options);
			this.backend = backend;

			const botConfig = this.options.config ?? createDefaultBotConfig(resolve(app.getPath("userData")));
			const runtimeBotConfig: BotConfig = {
				...botConfig,
				workingDir: telegram.workingDir || botConfig.workingDir,
			};
			log({
				level: "info",
				message: "Resident Core LettaBot creating LettaBot",
				data: {
					telegram: summarizeTelegramConfig(telegram),
					workingDir: runtimeBotConfig.workingDir,
					hasCustomBotFactory: Boolean(this.options.createBot),
				},
			});
			this.bot = this.options.createBot
				? this.options.createBot(runtimeBotConfig, backend)
				: new LettaBot(runtimeBotConfig, { sessionBackend: backend });
			log({
				level: "info",
				message: "Resident Core LettaBot created LettaBot",
				data: {
					workingDir: runtimeBotConfig.workingDir,
					hasBot: Boolean(this.bot),
				},
			});

			const agentConfig = createTelegramAgentConfig(runtimeBotConfig, telegram);
			const adapters = createChannelsForAgent(agentConfig, runtimeBotConfig.workingDir, DEFAULT_ATTACHMENTS_MAX_BYTES);
			log({
				level: "info",
				message: "Resident Core LettaBot created channel adapters",
				data: {
					channelCount: adapters.length,
					workingDir: runtimeBotConfig.workingDir,
				},
			});
			for (const adapter of adapters) {
				this.bot.registerChannel(adapter);
			}

			await this.bot.start();
			log({
				level: "info",
				message: "Resident Core LettaBot bot.start resolved",
				data: {
					channelCount: adapters.length,
					workingDir: runtimeBotConfig.workingDir,
				},
			});
		} catch (error) {
			this.started = false;
			this.backend = null;
			this.bot = null;
			log({
				level: "error",
				message: "Resident Core LettaBot Telegram startup failed",
				data: serializeError(error),
			});
			throw error;
		}
	}

	async stop(): Promise<void> {
		if (!this.started) return;
		this.started = false;
		this.backend?.invalidateSession();
		this.backend = null;
		try {
			await this.bot?.stop();
		} catch (error) {
			log({
				level: "warn",
				message: "Resident Core LettaBot stop failed",
				data: serializeError(error),
			});
		}
		this.bot = null;
	}

	getBot(): ResidentCoreLettaBotHandle | null {
		return this.bot;
	}

	getBackend(): SessionBackend | null {
		return this.backend;
	}
}

export function createResidentCoreLettaBotHost(options: ResidentCoreLettaBotHostOptions): ResidentCoreLettaBotHost {
	return new ResidentCoreLettaBotHost(options);
}
