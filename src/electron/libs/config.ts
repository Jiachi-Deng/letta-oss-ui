import { app } from "electron";
import { config as dotenvConfig, parse as dotenvParse } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const DEFAULT_LETTA_BASE_URL = "https://api.letta.com";
const DEFAULT_LOCAL_LETTA_SERVER_URL = app.isPackaged
  ? "http://127.0.0.1:18383"
  : "http://localhost:8283";
const CONFIG_FILE_NAME = "config.json";
const DEFAULT_CONNECTION_TYPE = "letta-server";

export type ConnectionType =
  | "letta-server"
  | "anthropic-compatible"
  | "openai-compatible";

type EnvSelection = {
  path: string;
  score: number;
  parsed: Record<string, string>;
};

export type LettaAppConfig = {
  connectionType: ConnectionType;
  LETTA_BASE_URL: string;
  LETTA_API_KEY?: string;
  model?: string;
  residentCore?: ResidentCoreConfig;
};

export type ResidentCoreTelegramStartupConfig = {
  token?: string;
  dmPolicy?: "pairing" | "allowlist" | "open";
  streaming?: boolean;
  workingDir?: string;
};

export type ResidentCoreConfig = {
  telegram?: ResidentCoreTelegramStartupConfig;
};

export type ResidentCoreLettaBotRuntimeConfig = {
  workingDir: string;
  telegram: ResidentCoreTelegramStartupConfig | null;
};

export type AppConfigLoadResult = {
  mode: "development" | "packaged";
  source:
    | "dev-env"
    | "dev-env-fallback"
    | "process-env"
    | "packaged-config"
    | "packaged-config-default"
    | "packaged-config-invalid";
  path?: string;
  config: LettaAppConfig;
};

type InitializeAppConfigOptions = {
  packaged?: boolean;
  userDataPath?: string;
};

export type AppConfigState = AppConfigLoadResult & {
  canEdit: boolean;
  requiresOnboarding: boolean;
};

let currentConfigLoadResult: AppConfigLoadResult | null = null;

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

function normalizeResidentCoreTelegramConfig(value: unknown): ResidentCoreTelegramStartupConfig | undefined {
  if (!value || typeof value !== "object") return undefined;

  const raw = value as Partial<Record<keyof ResidentCoreTelegramStartupConfig, unknown>>;
  const token = normalizeString(raw.token);
  const dmPolicy = raw.dmPolicy === "pairing" || raw.dmPolicy === "allowlist" || raw.dmPolicy === "open"
    ? raw.dmPolicy
    : undefined;
  const streaming = normalizeBoolean(raw.streaming);
  const workingDir = normalizeString(raw.workingDir);

  if (!token && !dmPolicy && streaming === undefined && !workingDir) {
    return undefined;
  }

  const config: ResidentCoreTelegramStartupConfig = {};
  if (token) config.token = token;
  if (dmPolicy) config.dmPolicy = dmPolicy;
  if (streaming !== undefined) config.streaming = streaming;
  if (workingDir) config.workingDir = workingDir;

  return config;
}

function normalizeResidentCoreConfig(value: unknown): ResidentCoreConfig | undefined {
  if (!value || typeof value !== "object") return undefined;

  const raw = value as Partial<Record<keyof ResidentCoreConfig, unknown>>;
  const telegram = normalizeResidentCoreTelegramConfig(raw.telegram);
  if (!telegram) return undefined;

  return { telegram };
}

function normalizeConnectionType(value: unknown, baseUrl?: string): ConnectionType {
  if (value === "letta-server" || value === "anthropic-compatible" || value === "openai-compatible") {
    return value;
  }

  if (typeof baseUrl === "string") {
    const normalizedBaseUrl = baseUrl.toLowerCase();
    if (normalizedBaseUrl.includes("/anthropic")) return "anthropic-compatible";
    if (normalizedBaseUrl.includes("/openai")) return "openai-compatible";
  }

  return DEFAULT_CONNECTION_TYPE;
}

function normalizeConfig(rawConfig: Partial<Record<keyof LettaAppConfig, unknown>>): LettaAppConfig {
  const baseUrl = normalizeString(rawConfig.LETTA_BASE_URL) ?? DEFAULT_LETTA_BASE_URL;
  const config: LettaAppConfig = {
    connectionType: normalizeConnectionType(rawConfig.connectionType, baseUrl),
    LETTA_BASE_URL: baseUrl,
  };

  const apiKey = normalizeString(rawConfig.LETTA_API_KEY);
  if (apiKey) {
    config.LETTA_API_KEY = apiKey;
  }

  const model = normalizeString(rawConfig.model);
  if (model) {
    config.model = model;
  }

  const residentCore = normalizeResidentCoreConfig(rawConfig.residentCore);
  if (residentCore) {
    config.residentCore = residentCore;
  }

  return config;
}

function applyConfigToProcessEnv(config: LettaAppConfig, clearMissing: boolean): void {
  if (config.connectionType === "letta-server") {
    process.env.LETTA_BASE_URL = config.LETTA_BASE_URL;
    delete process.env.LETTA_COMPAT_BASE_URL;
  } else {
    process.env.LETTA_COMPAT_BASE_URL = config.LETTA_BASE_URL;
    process.env.LETTA_BASE_URL = getCompatibleLettaServerUrl();
  }

  if (config.LETTA_API_KEY) {
    process.env.LETTA_API_KEY = config.LETTA_API_KEY;
  } else if (clearMissing) {
    delete process.env.LETTA_API_KEY;
  }

  if (!process.env.LETTA_API_KEY && process.env.LETTA_BASE_URL?.includes("localhost")) {
    process.env.LETTA_API_KEY = "local-dev-key";
  }
}

export function getCompatibleLettaServerUrl(): string {
  return normalizeString(process.env.LETTA_LOCAL_SERVER_URL)
    ?? normalizeString(process.env.LOCAL_LETTA_SERVER_URL)
    ?? DEFAULT_LOCAL_LETTA_SERVER_URL;
}

function requiresApiKey(config: LettaAppConfig): boolean {
  if (config.connectionType === "letta-server") {
    return !config.LETTA_BASE_URL.includes("localhost") && !config.LETTA_API_KEY;
  }

  return !config.LETTA_API_KEY;
}

function requiresModel(config: LettaAppConfig): boolean {
  return config.connectionType !== "letta-server" && !config.model;
}

function readResidentCoreTelegramFromEnv(): ResidentCoreTelegramStartupConfig | undefined {
  const token = normalizeString(
    process.env.LETTA_DESKTOP_TELEGRAM_BOT_TOKEN
      ?? process.env.RESIDENT_CORE_TELEGRAM_BOT_TOKEN
      ?? process.env.LETTA_TELEGRAM_BOT_TOKEN,
  );
  const dmPolicy = process.env.LETTA_DESKTOP_TELEGRAM_DM_POLICY
    ?? process.env.RESIDENT_CORE_TELEGRAM_DM_POLICY
    ?? process.env.LETTA_TELEGRAM_DM_POLICY;
  const streamingRaw = normalizeString(
    process.env.LETTA_DESKTOP_TELEGRAM_STREAMING
      ?? process.env.RESIDENT_CORE_TELEGRAM_STREAMING
      ?? process.env.LETTA_TELEGRAM_STREAMING,
  );
  const workingDir = normalizeString(
    process.env.LETTA_DESKTOP_TELEGRAM_WORKING_DIR
      ?? process.env.RESIDENT_CORE_TELEGRAM_WORKING_DIR
      ?? process.env.LETTA_TELEGRAM_WORKING_DIR,
  );

  if (!token && !dmPolicy && streamingRaw === undefined && !workingDir) {
    return undefined;
  }

  const config: ResidentCoreTelegramStartupConfig = {};
  if (token) config.token = token;
  if (dmPolicy === "pairing" || dmPolicy === "allowlist" || dmPolicy === "open") {
    config.dmPolicy = dmPolicy;
  }
  if (streamingRaw !== undefined) {
    const streaming = normalizeBoolean(streamingRaw);
    if (streaming !== undefined) config.streaming = streaming;
  }
  if (workingDir) config.workingDir = workingDir;

  return config;
}

function toAppConfigState(result: AppConfigLoadResult): AppConfigState {
  return {
    ...result,
    canEdit: result.mode === "packaged",
    requiresOnboarding:
      result.mode === "packaged" &&
      (requiresApiKey(result.config) || requiresModel(result.config)),
  };
}

function inspectEnvFile(envPath: string): EnvSelection | null {
  if (!existsSync(envPath)) return null;

  try {
    const parsed = dotenvParse(readFileSync(envPath));
    const hasLettaBaseUrl =
      typeof parsed.LETTA_BASE_URL === "string" && parsed.LETTA_BASE_URL.trim().length > 0;
    const hasLettaApiKey =
      typeof parsed.LETTA_API_KEY === "string" && parsed.LETTA_API_KEY.trim().length > 0;

    if (!hasLettaBaseUrl && !hasLettaApiKey) {
      return null;
    }

    let score = 0;
    if (hasLettaBaseUrl) score += 2;
    if (hasLettaApiKey) score += 2;
    if (parsed.LETTA_BASE_URL?.includes("localhost")) score += 3;
    if (parsed.LETTA_API_KEY?.includes("your-api-key-here")) score -= 3;

    return { path: envPath, score, parsed };
  } catch (error) {
    console.warn("[config] Failed to parse .env file:", envPath, error);
    return null;
  }
}

function getDevelopmentEnvPaths(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));

  return Array.from(
    new Set([
      resolve(process.cwd(), ".env"),
      resolve(process.cwd(), "..", ".env"),
      resolve(moduleDir, "../../.env"),
      resolve(moduleDir, "../../../.env"),
    ]),
  );
}

function loadDevelopmentConfig(): AppConfigLoadResult {
  const candidatePaths = getDevelopmentEnvPaths();
  const candidates = candidatePaths
    .map(inspectEnvFile)
    .filter((entry): entry is EnvSelection => entry !== null)
    .sort((left, right) => right.score - left.score);

  if (candidates.length > 0) {
    const selected = candidates[0];
    dotenvConfig({ path: selected.path, override: true });

    const config = normalizeConfig(process.env);
    applyConfigToProcessEnv(config, false);

    console.log(
      "[config] Loaded development Letta env from:",
      selected.path,
      config.LETTA_BASE_URL,
    );

    return {
      mode: "development",
      source: "dev-env",
      path: selected.path,
      config,
    };
  }

  for (const envPath of candidatePaths) {
    if (!existsSync(envPath)) continue;

    dotenvConfig({ path: envPath });

    const config = normalizeConfig(process.env);
    applyConfigToProcessEnv(config, false);

    console.log("[config] Loaded development env fallback from:", envPath, config.LETTA_BASE_URL);

    return {
      mode: "development",
      source: "dev-env-fallback",
      path: envPath,
      config,
    };
  }

  const config = normalizeConfig(process.env);
  applyConfigToProcessEnv(config, false);

  console.warn("[config] No development .env file found; using process env/defaults");

  return {
    mode: "development",
    source: "process-env",
    config,
  };
}

export function getUserConfigPath(userDataPath = app.getPath("userData")): string {
  return join(userDataPath, CONFIG_FILE_NAME);
}

function readPackagedConfig(configPath: string): LettaAppConfig | null {
  try {
    const rawFile = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(rawFile) as Partial<Record<keyof LettaAppConfig, unknown>>;
    return normalizeConfig(parsed);
  } catch (error) {
    console.warn("[config] Failed to read packaged config file:", configPath, error);
    return null;
  }
}

function writePackagedConfig(configPath: string, config: LettaAppConfig): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

function loadPackagedConfig(userDataPath?: string): AppConfigLoadResult {
  const configPath = getUserConfigPath(userDataPath);

  if (!existsSync(configPath)) {
    const defaultConfig = normalizeConfig({});
    writePackagedConfig(configPath, defaultConfig);
    applyConfigToProcessEnv(defaultConfig, true);

    console.log("[config] Initialized packaged Letta config at:", configPath);

    return {
      mode: "packaged",
      source: "packaged-config-default",
      path: configPath,
      config: defaultConfig,
    };
  }

  const config = readPackagedConfig(configPath);
  if (config) {
    applyConfigToProcessEnv(config, true);

    console.log("[config] Loaded packaged Letta config from:", configPath, config.LETTA_BASE_URL);

    return {
      mode: "packaged",
      source: "packaged-config",
      path: configPath,
      config,
    };
  }

  const fallbackConfig = normalizeConfig({});
  applyConfigToProcessEnv(fallbackConfig, true);

  console.warn(
    "[config] Packaged config is invalid. Using defaults until the file is fixed:",
    configPath,
  );

  return {
    mode: "packaged",
    source: "packaged-config-invalid",
    path: configPath,
    config: fallbackConfig,
  };
}

export function initializeAppConfig(
  options: InitializeAppConfigOptions = {},
): AppConfigLoadResult {
  const packaged = options.packaged ?? app.isPackaged;
  currentConfigLoadResult = packaged ? loadPackagedConfig(options.userDataPath) : loadDevelopmentConfig();
  return currentConfigLoadResult;
}

export function getAppConfigState(): AppConfigState {
  if (!currentConfigLoadResult) {
    initializeAppConfig();
  }

  return toAppConfigState(currentConfigLoadResult!);
}

export function saveAppConfig(configInput: Partial<LettaAppConfig>): AppConfigState {
  if (!app.isPackaged) {
    const nextConfig = normalizeConfig({
      ...getAppConfigState().config,
      ...configInput,
    });
    applyConfigToProcessEnv(nextConfig, true);
    currentConfigLoadResult = {
      mode: "development",
      source: "process-env",
      config: nextConfig,
    };
    return toAppConfigState(currentConfigLoadResult);
  }

  const configPath = getUserConfigPath();
  const nextConfig = normalizeConfig({
    ...getAppConfigState().config,
    ...configInput,
  });

  writePackagedConfig(configPath, nextConfig);
  applyConfigToProcessEnv(nextConfig, true);

  currentConfigLoadResult = {
    mode: "packaged",
    source: "packaged-config",
    path: configPath,
    config: nextConfig,
  };

  console.log("[config] Saved packaged Letta config to:", configPath, nextConfig.LETTA_BASE_URL);

  return toAppConfigState(currentConfigLoadResult);
}

export function getResidentCoreLettaBotRuntimeConfig(): ResidentCoreLettaBotRuntimeConfig {
  const appConfigTelegram = getAppConfigState().config.residentCore?.telegram;
  const envTelegram = readResidentCoreTelegramFromEnv();
  const telegram = normalizeResidentCoreTelegramConfig({
    ...appConfigTelegram,
    ...envTelegram,
  });

  return {
    workingDir: telegram?.workingDir ?? join(app.getPath("userData"), "lettabot"),
    telegram: telegram ?? null,
  };
}
