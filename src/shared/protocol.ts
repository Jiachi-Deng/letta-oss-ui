import type { CanUseToolResponse } from "@letta-ai/letta-code-sdk";
import type {
	AppAssistantMessage,
	AppInitMessage,
	AppMessage,
	AppReasoningMessage,
	AppResultMessage,
	AppStreamEventMessage,
	AppStreamMessage,
	AppToolCallMessage,
	AppToolResultMessage,
	UserPromptMessage,
} from "./message-normalizer.js";

export type DiagnosticSummary = {
	traceId: string;
	turnId?: string;
	sessionId?: string;
	summary: string;
	errorCode?: string;
	lastSuccessfulDecisionId?: string;
	firstFailedDecisionId?: string;
	suggestedAction?: string;
	createdAt?: string;
	updatedAt?: string;
	stepCount?: number;
	steps: Array<{
		component: string;
		decisionId?: string;
		status: "ok" | "warning" | "error";
		message: string;
		errorCode?: string;
		data?: Record<string, unknown>;
	}>;
};

export type DiagnosticSummaryListItem = Omit<DiagnosticSummary, "steps">;

export type SessionStatus = "idle" | "running" | "completed" | "error";

export type AgentRecord = {
	agentId: string;
	lastUsedAt: string;
	name?: string;
	conversationMode?: "shared";
	channels?: Record<string, boolean>;
};

export type AgentRegistryEntry = {
	key: string;
	record: AgentRecord;
};

export type AgentActiveResult = {
	success: boolean;
	activeAgentKey: string;
	agent: AgentRecord | null;
	agents: AgentRegistryEntry[];
	error?: string;
};

export type AgentMutationResult = AgentActiveResult & {
	agentKey: string;
};

export type StreamMessage = AppMessage;
export type SDKMessage = AppStreamMessage;
export type SDKInitMessage = AppInitMessage;
export type SDKAssistantMessage = AppAssistantMessage;
export type SDKToolCallMessage = AppToolCallMessage;
export type SDKToolResultMessage = AppToolResultMessage;
export type SDKReasoningMessage = AppReasoningMessage;
export type SDKResultMessage = AppResultMessage;
export type SDKStreamEventMessage = AppStreamEventMessage;

export type SessionInfo = {
	id: string;
	title: string;
	status: SessionStatus;
	lettaConversationId?: string;
	cwd?: string;
	createdAt: number;
	updatedAt: number;
};

export type ServerEvent =
	| { type: "stream.message"; payload: { sessionId: string; message: StreamMessage } }
	| { type: "stream.user_prompt"; payload: { sessionId: string; prompt: string } }
	| { type: "session.status"; payload: { sessionId: string; status: SessionStatus; title?: string; cwd?: string; error?: string } }
	| { type: "session.list"; payload: { sessions: SessionInfo[] } }
	| { type: "session.history"; payload: { sessionId: string; status: SessionStatus; messages: StreamMessage[] } }
	| { type: "session.deleted"; payload: { sessionId: string } }
	| { type: "agent.active"; payload: { activeAgentKey: string; agent: AgentRecord | null; agents: AgentRegistryEntry[] } }
	| { type: "agent.list"; payload: { activeAgentKey: string; agents: AgentRegistryEntry[] } }
	| { type: "agent.switch.result"; payload: AgentActiveResult }
	| { type: "agent.create.result"; payload: AgentMutationResult }
	| { type: "agent.rename.result"; payload: AgentMutationResult }
	| { type: "agent.delete.result"; payload: AgentMutationResult }
	| { type: "permission.request"; payload: { sessionId: string; toolUseId: string; toolName: string; input: unknown } }
	| { type: "runner.error"; payload: { sessionId?: string; traceId?: string; message: string } };

export type ClientEvent =
	| { type: "session.start"; payload: { title: string; prompt: string; cwd?: string } }
	| { type: "session.continue"; payload: { sessionId: string; prompt: string; cwd?: string } }
	| { type: "session.stop"; payload: { sessionId: string } }
	| { type: "session.delete"; payload: { sessionId: string } }
	| { type: "session.list" }
	| { type: "session.history"; payload: { sessionId: string } }
	| { type: "agent.active.get" }
	| { type: "agent.list" }
	| { type: "agent.switch"; payload: { agentKey: string } }
	| { type: "agent.create"; payload: { name?: string } }
	| { type: "agent.rename"; payload: { agentKey: string; name: string } }
	| { type: "agent.delete"; payload: { agentKey: string } }
	| { type: "permission.response"; payload: { sessionId: string; toolUseId: string; result: CanUseToolResponse } };

export type { UserPromptMessage, CanUseToolResponse };
