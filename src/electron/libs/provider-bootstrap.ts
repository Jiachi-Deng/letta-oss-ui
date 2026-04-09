import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import type { ConnectionType, LettaAppConfig } from "./config.js";
import { getCompatibleLettaServerUrl } from "./config.js";
import { waitForBundledLettaServerReady } from "./bundled-letta-server.js";
import {
  E_LETTA_CLI_GLOBAL_SHADOWED,
  E_LETTA_CLI_EXIT_NON_ZERO,
  E_LETTA_CLI_SPAWN_FAILED,
  E_PROVIDER_CONNECT_FAILED,
} from "../../shared/error-codes.js";
import {
  BOOT_CONN_001,
  BOOT_CONN_002,
  CLI_CONNECT_001,
  CLI_CONNECT_002,
  CLI_CONNECT_003,
  CLI_CONNECT_004,
  CLI_CONNECT_005,
  CLI_CONNECT_006,
} from "../../shared/decision-ids.js";
import {
  createComponentLogger,
  type TraceContext,
} from "./trace.js";

type SupportedProviderType = "anthropic" | "minimax" | "openai";

type CompatibleProviderConfig = {
  providerType: SupportedProviderType;
  providerName: string;
  providerToken: SupportedProviderType;
  modelHandle: string;
  serverBaseUrl: string;
  modelName: string;
};

export type RuntimeBootstrapAction =
  | {
      kind: "none";
    }
  | {
      kind: "compatible-provider";
      providerType: SupportedProviderType;
      providerName: string;
      providerToken: SupportedProviderType;
      providerBaseUrl: string;
      serverBaseUrl: string;
      modelHandle: string;
      modelName: string;
    };

export type RuntimeConnectionInfo = {
  baseUrl: string;
  apiKey?: string;
  modelHandle?: string;
  cliPath: string;
  bootstrapAction: RuntimeBootstrapAction;
};

const LOCAL_SERVER_API_KEY = "local-dev-key";
const require = createRequire(import.meta.url);
const compatibleProviderCache = new Map<string, Promise<CompatibleProviderConfig>>();
const providerLog = createComponentLogger("provider-bootstrap");
const cliLog = createComponentLogger("letta-code-cli");
const CLI_OUTPUT_PREVIEW_LIMIT = 200;

function normalizeString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function summarizeCliOutput(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > CLI_OUTPUT_PREVIEW_LIMIT
    ? `${normalized.slice(0, CLI_OUTPUT_PREVIEW_LIMIT)}…`
    : normalized;
}

function normalizeModelName(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    throw new Error("Model is required for compatible API modes.");
  }

  const slashIndex = trimmed.indexOf("/");
  return slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
}

function getCompatibleProviderSpec(
  connectionType: ConnectionType,
  model: string,
): Omit<CompatibleProviderConfig, "serverBaseUrl"> {
  const normalizedModel = normalizeModelName(model);

  if (connectionType === "anthropic-compatible") {
    if (/^MiniMax-/i.test(normalizedModel)) {
      return {
        providerType: "minimax",
        providerName: "lc-minimax",
        providerToken: "minimax",
        modelHandle: `lc-minimax/${normalizedModel}`,
        modelName: normalizedModel,
      };
    }

    return {
      providerType: "anthropic",
      providerName: "lc-anthropic",
      providerToken: "anthropic",
      modelHandle: `lc-anthropic/${normalizedModel}`,
      modelName: normalizedModel,
    };
  }

  return {
    providerType: "openai",
    providerName: "lc-openai",
    providerToken: "openai",
    modelHandle: `lc-openai/${normalizedModel}`,
    modelName: normalizedModel,
  };
}

function resolveLocalCliCandidates(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packagedResourcesRoot = process.resourcesPath;
  const workspaceRoot = resolve(moduleDir, "../../../../..");

  return [
    resolve(
      packagedResourcesRoot,
      "app.asar.unpacked/node_modules/@letta-ai/letta-code/letta.js",
    ),
    resolve(
      packagedResourcesRoot,
      "node_modules/@letta-ai/letta-code/letta.js",
    ),
    resolve(workspaceRoot, "vendor/letta-code/letta.js"),
    resolve(moduleDir, "../../../../letta-code/letta.js"),
    resolve(moduleDir, "../../../node_modules/@letta-ai/letta-code/letta.js"),
    resolve(process.cwd(), "letta-ui/node_modules/@letta-ai/letta-code/letta.js"),
    resolve(process.cwd(), "letta-code/letta.js"),
  ];
}

export function resolveLettaCliPath(trace?: TraceContext): string {
  const explicitPath = normalizeString(process.env.LETTA_CLI_PATH);
  if (explicitPath && existsSync(explicitPath)) {
    if (app.isPackaged && !explicitPath.startsWith(process.resourcesPath)) {
      providerLog({
        level: "warn",
        message: "packaged runtime is resolving an external LETTA_CLI_PATH",
        decision_id: BOOT_CONN_001,
        error_code: E_LETTA_CLI_GLOBAL_SHADOWED,
        trace_id: trace?.traceId,
        turn_id: trace?.turnId,
        session_id: trace?.sessionId,
        data: {
          cliPath: explicitPath,
          resourcesPath: process.resourcesPath,
        },
      });
    }
    return explicitPath;
  }

  if (app.isPackaged) {
    for (const candidate of resolveLocalCliCandidates()) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  try {
    const resolved = require.resolve("@letta-ai/letta-code");
    if (existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // fall through to local candidates
  }

  for (const candidate of resolveLocalCliCandidates()) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to resolve @letta-ai/letta-code CLI. Install the local package or set LETTA_CLI_PATH.",
  );
}

async function runLettaCli(
  args: string[],
  envOverrides: Record<string, string>,
  trace?: TraceContext,
): Promise<void> {
  const cliPath = resolveLettaCliPath(trace);
  const useElectronRuntime = Boolean(process.versions.electron);
  const command = useElectronRuntime ? process.execPath : "node";

  await new Promise<void>((resolvePromise, rejectPromise) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let stdoutObserved = false;
    let stderrObserved = false;

    cliLog({
      level: "info",
      message: "letta-code CLI spawn started",
      decision_id: CLI_CONNECT_001,
      trace_id: trace?.traceId,
      turn_id: trace?.turnId,
      session_id: trace?.sessionId,
      data: {
        cliPath,
        command,
        argumentCount: args.length,
        electronRuntime: useElectronRuntime,
      },
    });

    const child = spawn(command, [cliPath, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(useElectronRuntime ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        ...envOverrides,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!stdoutObserved && text.trim()) {
        stdoutObserved = true;
        cliLog({
          level: "info",
          message: "letta-code CLI stdout observed",
          decision_id: CLI_CONNECT_002,
          trace_id: trace?.traceId,
          turn_id: trace?.turnId,
          session_id: trace?.sessionId,
          data: {
            cliPath,
            chunkLength: text.length,
            preview: summarizeCliOutput(text),
          },
        });
      }
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (!stderrObserved && text.trim()) {
        stderrObserved = true;
        cliLog({
          level: "info",
          message: "letta-code CLI stderr observed",
          decision_id: CLI_CONNECT_003,
          trace_id: trace?.traceId,
          turn_id: trace?.turnId,
          session_id: trace?.sessionId,
          data: {
            cliPath,
            chunkLength: text.length,
            preview: summarizeCliOutput(text),
          },
        });
      }
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cliLog({
        level: "error",
        message: "letta-code CLI spawn failed",
        decision_id: CLI_CONNECT_006,
        error_code: E_LETTA_CLI_SPAWN_FAILED,
        trace_id: trace?.traceId,
        turn_id: trace?.turnId,
        session_id: trace?.sessionId,
        data: {
          cliPath,
          command,
          error: error.message,
        },
      });
      rejectPromise(error);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;

      const stdoutPreview = stdout.trim() ? summarizeCliOutput(stdout) : undefined;
      const stderrPreview = stderr.trim() ? summarizeCliOutput(stderr) : undefined;
      const summaryData = {
        cliPath,
        command,
        exitCode: code,
        signal: signal ?? undefined,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
        stdoutPreview,
        stderrPreview,
      };

      if (code === 0) {
        cliLog({
          level: "info",
          message: "letta-code CLI exited successfully",
          decision_id: CLI_CONNECT_004,
          trace_id: trace?.traceId,
          turn_id: trace?.turnId,
          session_id: trace?.sessionId,
          data: summaryData,
        });
        resolvePromise();
        return;
      }

      cliLog({
        level: "error",
        message: "letta-code CLI exited non-zero",
        decision_id: CLI_CONNECT_005,
        error_code: E_LETTA_CLI_EXIT_NON_ZERO,
        trace_id: trace?.traceId,
        turn_id: trace?.turnId,
        session_id: trace?.sessionId,
        data: summaryData,
      });

      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
      rejectPromise(
        new Error(
          `letta connect failed with exit code ${code}${
            details ? `:\n${details}` : ""
          }`,
        ),
      );
    });
  });
}

export async function ensureCompatibleProvider(
  config: LettaAppConfig,
  trace?: TraceContext,
): Promise<CompatibleProviderConfig> {
  if (config.connectionType === "letta-server") {
    throw new Error(
      "Compatible provider bootstrap should only run for compatible connection types.",
    );
  }

  const apiKey = config.LETTA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("API key is required for compatible provider modes.");
  }

  const providerBaseUrl = normalizeUrl(config.LETTA_BASE_URL);
  const serverBaseUrl = normalizeUrl(
    app.isPackaged
      ? await waitForBundledLettaServerReady(undefined, trace)
      : getCompatibleLettaServerUrl(),
  );
  const compatibleProvider = {
    ...getCompatibleProviderSpec(config.connectionType, config.model ?? ""),
    serverBaseUrl,
  };
  const cacheKey = JSON.stringify({
    connectionType: config.connectionType,
    providerBaseUrl,
    apiKey,
    modelHandle: compatibleProvider.modelHandle,
    serverBaseUrl,
  });

  const cached = compatibleProviderCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const registrationPromise = runLettaCli(
    [
      "connect",
      compatibleProvider.providerToken,
      "--api-key",
      apiKey,
      "--base-url",
      providerBaseUrl,
    ],
    {
      LETTA_BASE_URL: serverBaseUrl,
      LETTA_API_KEY: getCompatibleServerApiKey(),
    },
    trace,
  ).then(() => compatibleProvider);

  compatibleProviderCache.set(cacheKey, registrationPromise);

  try {
    return await registrationPromise;
  } catch (error) {
    compatibleProviderCache.delete(cacheKey);
    throw error;
  }
}

export function getCompatibleServerApiKey(): string {
  return (
    normalizeString(process.env.LETTA_LOCAL_SERVER_API_KEY) ??
    LOCAL_SERVER_API_KEY
  );
}

function applyRuntimeConnectionEnv(connection: RuntimeConnectionInfo): void {
  process.env.LETTA_BASE_URL = connection.baseUrl;
  process.env.LETTA_CLI_PATH = connection.cliPath;

  if (connection.apiKey) {
    process.env.LETTA_API_KEY = connection.apiKey;
  } else {
    delete process.env.LETTA_API_KEY;
  }
}

export async function prepareRuntimeConnection(
  config: LettaAppConfig,
  trace?: TraceContext,
): Promise<RuntimeConnectionInfo> {
  providerLog({
    level: "info",
    message: "runtime connection bootstrap started",
    decision_id: BOOT_CONN_001,
    trace_id: trace?.traceId,
    turn_id: trace?.turnId,
    session_id: trace?.sessionId,
    data: {
      connectionType: config.connectionType,
      baseUrl: normalizeUrl(config.LETTA_BASE_URL),
      model: config.model,
    },
  });

  const cliPath = resolveLettaCliPath(trace);

  if (config.connectionType === "letta-server") {
    const baseUrl = normalizeUrl(config.LETTA_BASE_URL);
    const apiKey = normalizeString(config.LETTA_API_KEY);
    const connection: RuntimeConnectionInfo = {
      baseUrl,
      apiKey: apiKey ?? (baseUrl.includes("localhost") ? LOCAL_SERVER_API_KEY : undefined),
      modelHandle: config.model,
      cliPath,
      bootstrapAction: { kind: "none" },
    };

    applyRuntimeConnectionEnv(connection);
    providerLog({
      level: "info",
      message: "runtime connection bootstrap resolved direct server mode",
      decision_id: BOOT_CONN_002,
      trace_id: trace?.traceId,
      turn_id: trace?.turnId,
      session_id: trace?.sessionId,
      data: {
        connectionType: config.connectionType,
        baseUrl: connection.baseUrl,
        cliPath,
        bootstrapAction: connection.bootstrapAction.kind,
      },
    });
    return connection;
  }

  try {
    const compatibleProvider = await ensureCompatibleProvider(config, trace);
    const connection: RuntimeConnectionInfo = {
      baseUrl: compatibleProvider.serverBaseUrl,
      apiKey: getCompatibleServerApiKey(),
      modelHandle: compatibleProvider.modelHandle,
      cliPath,
      bootstrapAction: {
        kind: "compatible-provider",
        providerType: compatibleProvider.providerType,
        providerName: compatibleProvider.providerName,
        providerToken: compatibleProvider.providerToken,
        providerBaseUrl: normalizeUrl(config.LETTA_BASE_URL),
        serverBaseUrl: compatibleProvider.serverBaseUrl,
        modelHandle: compatibleProvider.modelHandle,
        modelName: compatibleProvider.modelName,
      },
    };

    applyRuntimeConnectionEnv(connection);
    providerLog({
      level: "info",
      message: "runtime connection bootstrap resolved compatible provider mode",
      decision_id: BOOT_CONN_002,
      trace_id: trace?.traceId,
      turn_id: trace?.turnId,
      session_id: trace?.sessionId,
      data: {
        connectionType: config.connectionType,
        providerType: compatibleProvider.providerType,
        baseUrl: connection.baseUrl,
        modelHandle: connection.modelHandle,
        cliPath,
      },
    });
    return connection;
  } catch (error) {
    providerLog({
      level: "error",
      message: "runtime connection bootstrap failed during compatible provider registration",
      decision_id: BOOT_CONN_002,
      error_code: E_PROVIDER_CONNECT_FAILED,
      trace_id: trace?.traceId,
      turn_id: trace?.turnId,
      session_id: trace?.sessionId,
      data: {
        connectionType: config.connectionType,
        baseUrl: normalizeUrl(config.LETTA_BASE_URL),
        model: config.model,
        error: String(error),
      },
    });
    throw error;
  }
}
