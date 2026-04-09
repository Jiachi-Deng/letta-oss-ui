import {
  clearCodeIslandSession as clearCodeIslandTransportSession,
  notifyCodeIslandAssistantMessage,
  notifyCodeIslandSessionStart,
  notifyCodeIslandStop,
  notifyCodeIslandToolResult,
  notifyCodeIslandToolRunning,
  notifyCodeIslandUserPrompt,
} from "./codeisland.js";

type CodeIslandMirrorState = {
  observedMainPathOutput: boolean;
};

const mirrorState = new Map<string, CodeIslandMirrorState>();

function getMirrorState(sessionId: string): CodeIslandMirrorState {
  let state = mirrorState.get(sessionId);
  if (!state) {
    state = {
      observedMainPathOutput: false,
    };
    mirrorState.set(sessionId, state);
  }
  return state;
}

function markObservedMainPathOutput(sessionId: string): void {
  getMirrorState(sessionId).observedMainPathOutput = true;
}

export function beginCodeIslandObservation(
  sessionId: string,
  cwd?: string,
  prompt?: string,
): void {
  const state = getMirrorState(sessionId);
  state.observedMainPathOutput = false;

  notifyCodeIslandSessionStart(sessionId, cwd);
  if (prompt !== undefined) {
    notifyCodeIslandUserPrompt(sessionId, prompt);
  }
}

export function mirrorCodeIslandToolRunning(
  sessionId: string,
  toolCallId: string,
  toolName: string,
): void {
  markObservedMainPathOutput(sessionId);
  notifyCodeIslandToolRunning(sessionId, toolCallId, toolName);
}

export function mirrorCodeIslandToolResult(
  sessionId: string,
  toolCallId: string,
  isError: boolean,
): void {
  markObservedMainPathOutput(sessionId);
  notifyCodeIslandToolResult(sessionId, toolCallId, isError);
}

export function mirrorCodeIslandAssistantMessage(sessionId: string, text: string): void {
  if (!text.trim()) return;

  markObservedMainPathOutput(sessionId);
  notifyCodeIslandAssistantMessage(sessionId, text);
}

export function finishCodeIslandObservation(
  sessionId: string,
  options: { reason?: string; error?: string; success?: boolean } = {},
): void {
  const state = getMirrorState(sessionId);
  const successfulCompletion = options.success === true;
  const error =
    options.error ??
    (successfulCompletion
      ? undefined
      : options.reason === "user"
        ? undefined
        : "Main path completed without observable assistant/tool output.");

  if (successfulCompletion && state.observedMainPathOutput) {
    notifyCodeIslandStop(sessionId);
    return;
  }

  notifyCodeIslandStop(sessionId, {
    reason: options.reason,
    error,
  });
}

export function clearCodeIslandObservation(sessionId: string): void {
  mirrorState.delete(sessionId);
  clearCodeIslandTransportSession(sessionId);
}
