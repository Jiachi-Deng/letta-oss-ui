import { app } from "electron";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import { getIconPath } from "../pathResolver.js";

type CodeIslandHookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "AfterAgentResponse"
  | "Stop";

type CodeIslandPayload = {
  session_id: string;
  _source: "letta";
  hook_event_name: CodeIslandHookEventName;
  tool_name?: string;
  prompt?: string;
  text?: string;
  last_assistant_message?: string;
  cwd?: string;
  stop_reason?: string;
  error?: string;
  _app_name?: string;
  _app_path?: string;
  _app_icon_path?: string;
  _app_pid?: number;
};

type SessionLifecycle = {
  started: boolean;
  stopped: boolean;
  lastAssistantMessage?: string;
  toolCalls: Map<string, string>;
};

const sessionLifecycles = new Map<string, SessionLifecycle>();
const SOCKET_TIMEOUT_MS = 500;
let didWarnSocketUnavailable = false;
let didWarnSocketRecovered = false;
const GENERIC_HOST_APP_NAMES = new Set(["", "Electron", "letta-cowork", "Letta Code"]);

function getSocketPath(): string | null {
  if (process.platform === "win32") return null;
  if (typeof process.getuid !== "function") return null;
  return `/tmp/codeisland-${process.getuid()}.sock`;
}

function getLifecycle(sessionId: string): SessionLifecycle {
  let lifecycle = sessionLifecycles.get(sessionId);
  if (!lifecycle) {
    lifecycle = {
      started: false,
      stopped: false,
      lastAssistantMessage: undefined,
      toolCalls: new Map(),
    };
    sessionLifecycles.set(sessionId, lifecycle);
  }
  return lifecycle;
}

function getExecutablePath(): string {
  try {
    return app.getPath("exe");
  } catch {
    return process.execPath;
  }
}

function getMacAppBundlePath(executablePath: string): string | undefined {
  const marker = `${path.sep}.app${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const markerIndex = executablePath.indexOf(marker);

  if (markerIndex === -1) return undefined;

  return executablePath.slice(0, markerIndex + 4);
}

function getHostAppPath(): string | undefined {
  const executablePath = getExecutablePath();

  if (process.platform === "darwin") {
    const appBundlePath = getMacAppBundlePath(executablePath);

    if (app.isPackaged) return appBundlePath;
    if (appBundlePath && path.basename(appBundlePath) !== "Electron.app") return appBundlePath;

    return undefined;
  }

  if (app.isPackaged) return executablePath;

  const executableName = path.basename(executablePath).toLowerCase();
  if (executableName === "electron" || executableName === "electron.exe") {
    return undefined;
  }

  return executablePath;
}

function getHostAppName(): string {
  const name = app.getName().trim();

  if (!name || GENERIC_HOST_APP_NAMES.has(name)) {
    return "Letta";
  }

  return name;
}

function getHostAppIconPath(): string | undefined {
  const appPath = getHostAppPath();

  if (app.isPackaged && appPath && existsSync(appPath)) return appPath;

  const iconPath = getIconPath();
  if (existsSync(iconPath)) return iconPath;
  if (appPath && existsSync(appPath)) return appPath;

  return undefined;
}

function buildPayload(
  sessionId: string,
  hookEventName: CodeIslandHookEventName,
  extra: Omit<CodeIslandPayload, "session_id" | "_source" | "hook_event_name"> = {},
): CodeIslandPayload {
  return {
    session_id: sessionId,
    _source: "letta",
    hook_event_name: hookEventName,
    _app_name: getHostAppName(),
    _app_path: getHostAppPath(),
    _app_icon_path: getHostAppIconPath(),
    _app_pid: process.pid,
    ...extra,
  };
}

function sendPayload(payload: CodeIslandPayload): void {
  const socketPath = getSocketPath();
  if (!socketPath) return;

  if (!existsSync(socketPath)) {
    if (!didWarnSocketUnavailable) {
      console.warn(`[codeisland] Socket unavailable at ${socketPath}. Restart CodeIsland to restore event delivery.`);
      didWarnSocketUnavailable = true;
      didWarnSocketRecovered = false;
    }
    return;
  }

  try {
    const socket = createConnection(socketPath);

    const close = () => {
      if (!socket.destroyed) {
        socket.destroy();
      }
    };

    socket.setTimeout(SOCKET_TIMEOUT_MS, close);
    socket.once("error", (error) => {
      if (!didWarnSocketUnavailable) {
        const err = error as NodeJS.ErrnoException;
        console.warn(`[codeisland] Failed to connect to ${socketPath}: ${err.code ?? "UNKNOWN"} ${err.message}`);
        didWarnSocketUnavailable = true;
        didWarnSocketRecovered = false;
      }
      close();
    });
    socket.once("connect", () => {
      if (!didWarnSocketRecovered) {
        console.log(`[codeisland] Connected to ${socketPath}`);
        didWarnSocketRecovered = true;
      }
      didWarnSocketUnavailable = false;
      try {
        socket.end(JSON.stringify(payload));
      } catch {
        close();
      }
    });
  } catch {
    // Ignore CodeIsland connection failures in production.
  }
}

export function notifyCodeIslandSessionStart(sessionId: string, cwd?: string): void {
  const lifecycle = getLifecycle(sessionId);
  if (lifecycle.started && !lifecycle.stopped) return;

  lifecycle.started = true;
  lifecycle.stopped = false;
  lifecycle.lastAssistantMessage = undefined;
  lifecycle.toolCalls.clear();

  sendPayload(buildPayload(sessionId, "SessionStart", {
    cwd,
  }));
}

export function notifyCodeIslandUserPrompt(sessionId: string, prompt: string): void {
  const lifecycle = getLifecycle(sessionId);
  if (!lifecycle.started || lifecycle.stopped) return;

  sendPayload(buildPayload(sessionId, "UserPromptSubmit", {
    prompt,
  }));
}

export function notifyCodeIslandToolRunning(sessionId: string, toolCallId: string, toolName: string): void {
  const lifecycle = getLifecycle(sessionId);
  if (!lifecycle.started || lifecycle.stopped) return;
  if (lifecycle.toolCalls.get(toolCallId) === toolName) return;

  lifecycle.toolCalls.set(toolCallId, toolName);

  sendPayload(buildPayload(sessionId, "PreToolUse", {
    tool_name: toolName,
  }));
}

export function notifyCodeIslandToolResult(sessionId: string, toolCallId: string, isError: boolean): void {
  const lifecycle = getLifecycle(sessionId);
  if (!lifecycle.started || lifecycle.stopped) return;

  const toolName = lifecycle.toolCalls.get(toolCallId);
  lifecycle.toolCalls.delete(toolCallId);

  sendPayload(buildPayload(sessionId, isError ? "PostToolUseFailure" : "PostToolUse", {
    tool_name: toolName,
  }));
}

export function notifyCodeIslandAssistantMessage(sessionId: string, text: string): void {
  const lifecycle = getLifecycle(sessionId);
  if (!lifecycle.started || lifecycle.stopped) return;

  lifecycle.lastAssistantMessage = text;

  sendPayload(buildPayload(sessionId, "AfterAgentResponse", {
    text,
  }));
}

export function notifyCodeIslandStop(sessionId: string, options?: { reason?: string; error?: string }): void {
  const lifecycle = getLifecycle(sessionId);
  if (!lifecycle.started || lifecycle.stopped) return;

  lifecycle.stopped = true;
  lifecycle.toolCalls.clear();

  sendPayload(buildPayload(sessionId, "Stop", {
    last_assistant_message: lifecycle.lastAssistantMessage,
    stop_reason: options?.reason,
    error: options?.error,
  }));
}

export function clearCodeIslandSession(sessionId: string): void {
  sessionLifecycles.delete(sessionId);
}
