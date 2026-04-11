import type {
  AgentActiveResult as SharedAgentActiveResult,
  AgentMutationResult as SharedAgentMutationResult,
  AgentRecord as SharedAgentRecord,
  AgentRegistryEntry as SharedAgentRegistryEntry,
  ClientEvent as SharedClientEvent,
  DiagnosticSummary as SharedDiagnosticSummary,
  DiagnosticSummaryListItem as SharedDiagnosticSummaryListItem,
  SDKAssistantMessage as SharedSDKAssistantMessage,
  SDKInitMessage as SharedSDKInitMessage,
  SDKMessage as SharedSDKMessage,
  SDKReasoningMessage as SharedSDKReasoningMessage,
  SDKResultMessage as SharedSDKResultMessage,
  SDKStreamEventMessage as SharedSDKStreamEventMessage,
  SDKToolCallMessage as SharedSDKToolCallMessage,
  SDKToolResultMessage as SharedSDKToolResultMessage,
  ServerEvent as SharedServerEvent,
  SessionInfo as SharedSessionInfo,
  SessionStatus as SharedSessionStatus,
  StreamMessage as SharedStreamMessage,
  UserPromptMessage,
  CanUseToolResponse,
} from "../shared/protocol.js";

export type StreamMessage = SharedStreamMessage;
export type SessionStatus = SharedSessionStatus;
export type DiagnosticSummary = SharedDiagnosticSummary;
export type DiagnosticSummaryListItem = SharedDiagnosticSummaryListItem;
export type AgentRecord = SharedAgentRecord;
export type AgentRegistryEntry = SharedAgentRegistryEntry;
export type AgentActiveResult = SharedAgentActiveResult;
export type AgentMutationResult = SharedAgentMutationResult;
export type SessionInfo = SharedSessionInfo;
export type ServerEvent = SharedServerEvent;
export type ClientEvent = SharedClientEvent;
export type { UserPromptMessage, CanUseToolResponse };
export type SDKMessage = SharedSDKMessage;
export type SDKInitMessage = SharedSDKInitMessage;
export type SDKAssistantMessage = SharedSDKAssistantMessage;
export type SDKToolCallMessage = SharedSDKToolCallMessage;
export type SDKToolResultMessage = SharedSDKToolResultMessage;
export type SDKReasoningMessage = SharedSDKReasoningMessage;
export type SDKResultMessage = SharedSDKResultMessage;
export type SDKStreamEventMessage = SharedSDKStreamEventMessage;
