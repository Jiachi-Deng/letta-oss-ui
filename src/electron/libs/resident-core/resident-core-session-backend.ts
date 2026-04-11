import type { CanUseToolCallback, SendMessage, Session } from "@letta-ai/letta-code-sdk";
import type { SessionBackend, SessionRunOptions, SessionRunResult } from "lettabot/core/interfaces.js";
import type { StreamMsg } from "lettabot/core/types.js";
import type { BotConfig } from "lettabot/core/types.js";
import type { ServerEvent, StreamMessage } from "../../types.js";
import { normalizeMessageContent } from "../../../shared/message-normalizer.js";
import { createResidentCoreSessionOwner, type ResidentCoreSessionOwner } from "./session-owner.js";

export type ResidentCoreSessionBackendEventSink = (event: ServerEvent) => void;

export type ResidentCoreSessionBackendOptions = {
	owner?: ResidentCoreSessionOwner;
	config: BotConfig;
	onServerEvent?: ResidentCoreSessionBackendEventSink;
	runtimeGeneration?: number;
};

export class ResidentCoreSessionBackend {
	private readonly owner: ResidentCoreSessionOwner;
	private readonly onServerEvent: ResidentCoreSessionBackendEventSink | null;

	constructor(private readonly options: ResidentCoreSessionBackendOptions) {
		this.owner = options.owner ?? createResidentCoreSessionOwner();
		this.onServerEvent = options.onServerEvent ?? null;
	}

	private emitServerEvent(event: ServerEvent): void {
		this.onServerEvent?.(event);
	}

	private normalizeStreamMessage(message: StreamMsg): StreamMessage {
		if (Object.prototype.hasOwnProperty.call(message, "content")) {
			return {
				...message,
				content: normalizeMessageContent((message as { content?: unknown }).content),
			} as StreamMessage;
		}

		return message as unknown as StreamMessage;
	}

	private resolveSessionId(session: Session, convKey?: string): string {
		const conversationId = typeof session.conversationId === "string" ? session.conversationId.trim() : "";
		const normalizedConvKey = convKey?.trim();
		return conversationId || normalizedConvKey || "shared";
	}

	warmSession(): Promise<void> {
		return this.owner.warmBotSession(this.options.config);
	}

	invalidateSession(key?: string): void {
		this.owner.invalidateBotSession(key, this.options.runtimeGeneration);
	}

	getSession(key: string): Session | undefined {
		return this.owner.getBotSession(key) as Session | undefined;
	}

	async ensureSessionForKey(key: string): Promise<Session> {
		return this.owner.ensureBotSessionForKey({
			config: this.options.config,
			convKey: key,
		}) as Promise<Session>;
	}

	persistSessionState(): void {
		// The Resident Core owner is authoritative for session state.
	}

	runSession(message: SendMessage, options: SessionRunOptions = {}): Promise<SessionRunResult> {
		return this.owner.runBotSession({
			message,
			config: this.options.config,
			canUseTool: options.canUseTool as CanUseToolCallback | undefined,
			convKey: options.convKey,
		}).then(({ session, stream }) => {
			const sessionId = this.resolveSessionId(session, options.convKey);
			const prompt = normalizeMessageContent(message);
			const emitServerEvent = this.emitServerEvent.bind(this);
			const normalizeStreamMessage = this.normalizeStreamMessage.bind(this);

			emitServerEvent({
				type: "session.status",
				payload: {
					sessionId,
					status: "running",
					title: sessionId,
				},
			});
			if (prompt.trim()) {
				emitServerEvent({
					type: "stream.user_prompt",
					payload: {
						sessionId,
						prompt,
					},
				});
			}

			const wrappedStream = async function* (): AsyncGenerator<StreamMsg> {
				let terminalStatus: "completed" | "error" | null = null;

				try {
					for await (const rawMessage of stream()) {
						const normalizedMessage = normalizeStreamMessage(rawMessage);
						emitServerEvent({
							type: "stream.message",
							payload: {
								sessionId,
								message: normalizedMessage,
							},
						});

						if (rawMessage.type === "result") {
							terminalStatus = rawMessage.success ? "completed" : "error";
							emitServerEvent({
								type: "session.status",
								payload: {
									sessionId,
									status: terminalStatus,
									title: sessionId,
									...(rawMessage.success ? {} : { error: String(rawMessage.error ?? "Bot run failed") }),
								},
							});
						}

						yield rawMessage;
					}

					if (!terminalStatus) {
						emitServerEvent({
							type: "session.status",
							payload: {
								sessionId,
								status: "completed",
								title: sessionId,
							},
						});
					}
				} catch (error) {
					emitServerEvent({
						type: "session.status",
						payload: {
							sessionId,
							status: "error",
							title: sessionId,
							error: error instanceof Error ? error.message : String(error),
						},
					});
					throw error;
				}
			}.bind(this);

			return {
				session,
				stream: wrappedStream,
			};
		}) as Promise<SessionRunResult>;
	}

	syncTodoToolCall(): void {
		// Not needed for Resident Core backed sessions.
	}
}

export function createResidentCoreSessionBackend(options: ResidentCoreSessionBackendOptions): SessionBackend {
	return new ResidentCoreSessionBackend(options) as unknown as SessionBackend;
}
