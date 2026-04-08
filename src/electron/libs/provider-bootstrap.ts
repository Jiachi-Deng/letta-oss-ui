import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import type { ConnectionType, LettaAppConfig } from "./config.js";
import { getCompatibleLettaServerUrl } from "./config.js";

type SupportedProviderType = "anthropic" | "minimax" | "openai";

type CompatibleProviderConfig = {
  providerType: SupportedProviderType;
  providerName: string;
  providerToken: SupportedProviderType;
  modelHandle: string;
  serverBaseUrl: string;
  modelName: string;
};

const LOCAL_SERVER_API_KEY = "local-dev-key";
const require = createRequire(import.meta.url);
const compatibleProviderCache = new Map<string, Promise<CompatibleProviderConfig>>();

function normalizeString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
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

  return [
    resolve(
      packagedResourcesRoot,
      "app.asar.unpacked/node_modules/@letta-ai/letta-code/letta.js",
    ),
    resolve(
      packagedResourcesRoot,
      "node_modules/@letta-ai/letta-code/letta.js",
    ),
    resolve(moduleDir, "../../../../letta-code/letta.js"),
    resolve(moduleDir, "../../../node_modules/@letta-ai/letta-code/letta.js"),
    resolve(process.cwd(), "letta-ui/node_modules/@letta-ai/letta-code/letta.js"),
    resolve(process.cwd(), "letta-code/letta.js"),
  ];
}

export function resolveLettaCliPath(): string {
  const explicitPath = normalizeString(process.env.LETTA_CLI_PATH);
  if (explicitPath && existsSync(explicitPath)) {
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
): Promise<void> {
  const cliPath = resolveLettaCliPath();
  const useElectronRuntime = Boolean(process.versions.electron);
  const command = useElectronRuntime ? process.execPath : "node";

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, [cliPath, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(useElectronRuntime ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        ...envOverrides,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

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
  const serverBaseUrl = normalizeUrl(getCompatibleLettaServerUrl());
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
