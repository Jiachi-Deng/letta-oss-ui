import { type Session as LettaSession, type SDKMessage, type CanUseToolResponse } from "@letta-ai/letta-code-sdk";
import type { ServerEvent, SessionStatus } from "../types.js";
import type { PendingPermission } from "./runtime-state.js";
import { normalizeMessageContent, normalizeSDKMessageForApp } from "../../shared/message-normalizer.js";
import {
	beginCodeIslandObservation,
	finishCodeIslandObservation,
	mirrorCodeIslandAssistantMessage,
	mirrorCodeIslandToolResult,
	mirrorCodeIslandToolRunning,
} from "./codeisland-observer.js";
import { E_SESSION_CONVERSATION_ID_MISSING, E_STREAM_EMPTY_RESULT } from "../../shared/error-codes.js";
import {
	PERMISSION_REQUEST_001,
	RUNNER_INIT_002,
	STREAM_001,
	STREAM_002,
	STREAM_EMPTY_RESULT_001,
} from "../../shared/decision-ids.js";
import {
	createComponentLogger,
	createTraceContext,
	extendTraceContext,
	type TraceContext,
} from "./trace.js";
import type { ResidentCoreSessionOwner } from "./resident-core/session-owner.js";

export type RunnerRuntimeDependencies = {
	sessionOwner: ResidentCoreSessionOwner;
};

export type RunnerSession = {
	id: string;
	title: string;
	status: string;
	cwd?: string;
	pendingPermissions: Map<string, PendingPermission>;
};

export type RunnerOptions = {
	prompt: string;
	session: RunnerSession;
	resumeConversationId?: string;
	trace?: TraceContext;
	onEvent: (event: ServerEvent) => void;
	onSessionUpdate?: (updates: { lettaConversationId?: string }) => void;
	runtime: RunnerRuntimeDependencies;
};

export type RunnerHandle = {
	abort: () => Promise<void>;
};

const DEBUG = process.env.DEBUG_RUNNER === "true";
const runnerLog = createComponentLogger("runner");

const log = (msg: string, data?: Record<string, unknown>, context?: TraceContext) => {
	runnerLog({
		level: "info",
		message: msg,
		data,
		trace_id: context?.traceId,
		turn_id: context?.turnId,
		session_id: context?.sessionId,
	});
};

const debug = (msg: string, data?: Record<string, unknown>, context?: TraceContext) => {
	if (!DEBUG) return;
	runnerLog({
		level: "debug",
		message: msg,
		data,
		trace_id: context?.traceId,
		turn_id: context?.turnId,
		session_id: context?.sessionId,
	});
};

export async function runLetta(options: RunnerOptions): Promise<RunnerHandle> {
	const { prompt, session, resumeConversationId, onEvent, onSessionUpdate } = options;
	let activeLettaSession: LettaSession | null = null;
	let terminalStatus: SessionStatus | null = null;
	let currentSessionId = session.id;
	let traceContext = options.trace ?? createTraceContext();
	let assistantOutputSeen = false;
	let emptyResultLogged = false;

	if (session.id !== "pending") {
		traceContext = extendTraceContext(traceContext, { sessionId: session.id });
	}

	debug(
		"runLetta called",
		{
			prompt: prompt.slice(0, 100) + (prompt.length > 100 ? "..." : ""),
			sessionId: session.id,
			resumeConversationId,
			cwd: session.cwd,
		},
		traceContext,
	);

	const sendMessage = (message: SDKMessage) => {
		const normalizedMessage = normalizeSDKMessageForApp(message);
		onEvent({
			type: "stream.message",
			payload: { sessionId: currentSessionId, message: normalizedMessage },
		});
	};

	const sendPermissionRequest = (toolUseId: string, toolName: string, input: unknown) => {
		runnerLog({
			level: "info",
			message: "permission request emitted",
			decision_id: PERMISSION_REQUEST_001,
			trace_id: traceContext.traceId,
			turn_id: traceContext.turnId,
			session_id: traceContext.sessionId,
			data: { toolUseId, toolName },
		});
		onEvent({
			type: "permission.request",
			payload: { sessionId: currentSessionId, toolUseId, toolName, input },
		});
	};

	const sendSessionStatus = (status: SessionStatus, extra: { error?: string } = {}) => {
		terminalStatus = status;
		onEvent({
			type: "session.status",
			payload: { sessionId: currentSessionId, status, title: currentSessionId, ...extra },
		});
	};

	(async () => {
		try {
			const canUseTool = async (toolName: string, input: unknown) => {
				if (toolName === "AskUserQuestion") {
					const toolUseId = crypto.randomUUID();
					sendPermissionRequest(toolUseId, toolName, input);
					return new Promise<CanUseToolResponse>((resolve) => {
						session.pendingPermissions.set(toolUseId, {
							toolUseId,
							toolName,
							input,
							resolve: (result) => {
								session.pendingPermissions.delete(toolUseId);
								resolve(result);
							},
						});
					});
				}
				return { behavior: "allow" as const };
			};

			const { session: lettaSession, stream } = await options.runtime.sessionOwner.runDesktopSession({
				prompt,
				session,
				resumeConversationId,
				trace: traceContext,
				canUseTool,
			});

			activeLettaSession = lettaSession;
			if (lettaSession.conversationId) {
				currentSessionId = lettaSession.conversationId;
				traceContext = extendTraceContext(traceContext, { sessionId: lettaSession.conversationId });
				debug(
					"session initialized",
					{ conversationId: lettaSession.conversationId, agentId: lettaSession.agentId },
					traceContext,
				);
				onSessionUpdate?.({ lettaConversationId: lettaSession.conversationId });
				beginCodeIslandObservation(currentSessionId, session.cwd, prompt);
			} else {
				runnerLog({
					level: "warn",
					message: "WARNING: no conversationId available after runDesktopSession()",
					decision_id: RUNNER_INIT_002,
					error_code: E_SESSION_CONVERSATION_ID_MISSING,
					trace_id: traceContext.traceId,
					turn_id: traceContext.turnId,
					session_id: traceContext.sessionId,
				});
			}

			let messageCount = 0;
			for await (const message of stream()) {
				messageCount++;
				debug("received message", { type: message.type, count: messageCount });
				sendMessage(message);

				if (message.type === "tool_call") {
					mirrorCodeIslandToolRunning(currentSessionId, message.toolCallId, message.toolName);
				}
				if (message.type === "tool_result") {
					mirrorCodeIslandToolResult(currentSessionId, message.toolCallId, message.isError);
				}
				if (message.type === "assistant") {
					const assistantText = normalizeMessageContent(message.content);
					if (assistantText.trim()) {
						if (!assistantOutputSeen) {
							assistantOutputSeen = true;
							runnerLog({
								level: "info",
								message: "first assistant output observed",
								decision_id: STREAM_001,
								trace_id: traceContext.traceId,
								turn_id: traceContext.turnId,
								session_id: traceContext.sessionId,
								data: { preview: assistantText.slice(0, 120) },
							});
						}
						mirrorCodeIslandAssistantMessage(currentSessionId, assistantText);
					}
				}
				if (message.type === "result") {
					const status = message.success ? "completed" : "error";
					if (message.success && !assistantOutputSeen) {
						emptyResultLogged = true;
					}
					runnerLog({
						level: message.success && !assistantOutputSeen ? "warn" : message.success ? "info" : "warn",
						message: message.success && !assistantOutputSeen
							? "stream result completed without assistant output"
							: "stream result received",
						decision_id: message.success && !assistantOutputSeen ? STREAM_EMPTY_RESULT_001 : STREAM_002,
						error_code: message.success && !assistantOutputSeen ? E_STREAM_EMPTY_RESULT : undefined,
						trace_id: traceContext.traceId,
						turn_id: traceContext.turnId,
						session_id: traceContext.sessionId,
						data: { success: message.success, status, assistantOutputSeen },
					});
					finishCodeIslandObservation(currentSessionId, {
						success: message.success,
						error: message.success ? undefined : String(message.error),
					});
					sendSessionStatus(status, message.success ? undefined : { error: message.error });
				}
			}

			if (terminalStatus === null) {
				if (!assistantOutputSeen && !emptyResultLogged) {
					runnerLog({
						level: "warn",
						message: "stream completed without assistant output",
						decision_id: STREAM_EMPTY_RESULT_001,
						error_code: E_STREAM_EMPTY_RESULT,
						trace_id: traceContext.traceId,
						turn_id: traceContext.turnId,
						session_id: traceContext.sessionId,
						data: { assistantOutputSeen },
					});
				}
				runnerLog({
					level: assistantOutputSeen ? "info" : "warn",
					message: assistantOutputSeen
						? "stream completed without explicit result message"
						: "stream completed without assistant output",
					decision_id: assistantOutputSeen ? STREAM_002 : STREAM_EMPTY_RESULT_001,
					error_code: assistantOutputSeen ? undefined : E_STREAM_EMPTY_RESULT,
					trace_id: traceContext.traceId,
					turn_id: traceContext.turnId,
					session_id: traceContext.sessionId,
					data: { assistantOutputSeen },
				});
				finishCodeIslandObservation(currentSessionId, { success: true });
				sendSessionStatus("completed");
			}
		} catch (error) {
			if ((error as Error).name === "AbortError") {
				debug("session aborted");
				return;
			}

			log(
				"ERROR in runLetta",
				{
					error: String(error),
					name: (error as Error).name,
					stack: (error as Error).stack,
				},
				traceContext,
			);
			finishCodeIslandObservation(currentSessionId, { error: String(error) });
			if (currentSessionId === "pending") {
				onEvent({
					type: "runner.error",
					payload: {
						message: String(error),
						traceId: traceContext.traceId,
						sessionId: traceContext.sessionId,
					},
				});
				return;
			}
			sendSessionStatus("error", { error: String(error) });
		} finally {
			try {
				activeLettaSession?.close();
			} catch (closeError) {
				log(
					"WARNING: failed to close Letta session transport",
					{ error: String(closeError) },
					traceContext,
				);
			}
			activeLettaSession = null;
		}
	})();

	return {
		abort: async () => {
			if (activeLettaSession) {
				await activeLettaSession.abort();
			}
		},
	};
}
