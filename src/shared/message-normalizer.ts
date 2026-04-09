import type {
  MessageContentItem,
  SDKAssistantMessage,
  SDKInitMessage,
  SDKMessage,
  SDKReasoningMessage,
  SDKResultMessage,
  SDKStreamEventMessage,
  SDKToolCallMessage,
  SDKToolResultMessage,
} from "@letta-ai/letta-code-sdk";

export type AppInitMessage = SDKInitMessage;
export type AppAssistantMessage = Omit<SDKAssistantMessage, "content"> & { content: string };
export type AppToolCallMessage = SDKToolCallMessage;
export type AppToolResultMessage = SDKToolResultMessage;
export type AppReasoningMessage = Omit<SDKReasoningMessage, "content"> & { content: string };
export type AppResultMessage = SDKResultMessage;
export type AppStreamEventMessage = SDKStreamEventMessage;

export type AppStreamMessage =
  | AppInitMessage
  | AppAssistantMessage
  | AppToolCallMessage
  | AppToolResultMessage
  | AppReasoningMessage
  | AppResultMessage
  | AppStreamEventMessage;

export type UserPromptMessage = {
  type: "user_prompt";
  prompt: string;
};

export type AppMessage = AppStreamMessage | UserPromptMessage;

function isTextContentItem(item: unknown): item is MessageContentItem & { type: "text" } {
  return Boolean(
    item &&
      typeof item === "object" &&
      "type" in item &&
      (item as { type?: unknown }).type === "text" &&
      "text" in item &&
      typeof (item as { text?: unknown }).text === "string",
  );
}

export function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content.map((part) => (isTextContentItem(part) ? part.text : "")).join("");
}

export function normalizeSDKMessageForApp(message: SDKMessage): AppStreamMessage {
  switch (message.type) {
    case "assistant":
      return {
        ...message,
        content: normalizeMessageContent(message.content),
      } as AppAssistantMessage;
    case "reasoning":
      return {
        ...message,
        content: normalizeMessageContent(message.content),
      } as AppReasoningMessage;
    default:
      return message as AppStreamMessage;
  }
}
