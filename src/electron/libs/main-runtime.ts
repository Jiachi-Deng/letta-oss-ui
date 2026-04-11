import { execSync } from "node:child_process";
import { app } from "electron";
import { mkdirSync } from "node:fs";
import { DEV_PORT, isDev } from "../util.js";
import {
  configureBundledLettaServerEnv,
  ensureBundledLettaServerStarted,
  stopBundledLettaServer,
} from "./bundled-letta-server.js";
import { createResidentCoreLettaBotHost, type ResidentCoreLettaBotHost } from "./resident-core/lettabot-host.js";
import {
  ensureCodeIslandStarted,
  startCodeIslandMonitor,
  type CodeIslandMonitorHandle,
} from "./bundled-codeisland.js";
import type { SessionBackend } from "lettabot/core/interfaces.js";
import type { BotConfig } from "lettabot/core/types.js";
import { getResidentCoreLettaBotRuntimeConfig, initializeAppConfig } from "./config.js";
import type { ResidentCoreLettaBotRuntimeConfig, ResidentCoreTelegramStartupConfig } from "./config.js";
import { createComponentLogger, createTraceContext, createTurnId } from "./trace.js";
import { join } from "node:path";
import { createResidentCoreSessionBackend } from "./resident-core/resident-core-session-backend.js";
import type { ResidentCoreSessionOwner } from "./resident-core/session-owner.js";
import {
  TG_RUNTIME_START_001,
  TG_RUNTIME_START_002,
  TG_RUNTIME_START_003,
} from "../../shared/decision-ids.js";
import { E_TELEGRAM_RUNTIME_START_FAILED } from "../../shared/error-codes.js";

const PRODUCT_NAME = "Letta";
const APP_ID = "com.jachi.letta";

export type ElectronRuntimeServices = {
  codeIslandMonitor: CodeIslandMonitorHandle | null;
  lettabotHost: ResidentCoreLettaBotHost | null;
};

export type ResidentCoreChannelsRuntimeBundle = {
  backend: SessionBackend;
  lettabotHost: ResidentCoreLettaBotHost;
  runtimeConfig: ResidentCoreLettaBotRuntimeConfig;
};

export type ResidentCoreTelegramRuntimeBundle = ResidentCoreChannelsRuntimeBundle;

const runtimeLog = createComponentLogger("main-runtime");

function maskTelegramToken(token?: string | null): string | null {
  const trimmedToken = token?.trim();
  if (!trimmedToken) return null;
  return `***${trimmedToken.slice(-4)}`;
}

function summarizeResidentCoreChannelsRuntimeConfig(config: ResidentCoreLettaBotRuntimeConfig): Record<string, unknown> {
  const telegram: ResidentCoreTelegramStartupConfig | null = config.channels.telegram ?? null;
  return {
    workingDir: config.workingDir,
    channels: {
      telegram: {
        hasToken: Boolean(telegram?.token?.trim()),
        tokenTail: maskTelegramToken(telegram?.token),
        dmPolicy: telegram?.dmPolicy ?? null,
        streaming: telegram?.streaming ?? null,
        workingDir: telegram?.workingDir ?? null,
      },
    },
  };
}

function createResidentCoreLettaBotConfig(
  runtimeConfig: ResidentCoreLettaBotRuntimeConfig,
): BotConfig {
  return {
    workingDir: runtimeConfig.workingDir,
    allowedTools: [],
    conversationMode: "shared",
    reuseSession: true,
    agentName: "ResidentCoreLettaBot",
    logging: {
      turnLogFile: join(runtimeConfig.workingDir, "turns.jsonl"),
      maxTurns: 500,
    },
  };
}

function configureRuntimeIdentity(): void {
  app.setName(PRODUCT_NAME);

  if (process.platform === "win32") {
    app.setAppUserModelId(APP_ID);
  }
}

function configureUserDataOverrideFromEnv(): void {
  const overridePath = process.env.LETTA_USER_DATA_PATH?.trim();
  if (!overridePath) return;
  mkdirSync(overridePath, { recursive: true });
  app.setPath("userData", overridePath);
}

function configureLettaCliPathFromSystem(): void {
  if (app.isPackaged) {
    return;
  }

  try {
    const whichCmd = process.platform === "win32" ? "where letta" : "which letta";
    const lettaPath = execSync(whichCmd, { encoding: "utf-8" }).trim();
    if (!lettaPath) return;

    const firstPath = lettaPath.split("\n")[0].trim();
    process.env.LETTA_CLI_PATH = firstPath;
    console.log("Found letta CLI at:", firstPath);
  } catch (error) {
    console.warn("Could not find letta CLI:", error);
  }
}

export function bootstrapElectronRuntime(): void {
  configureRuntimeIdentity();
  configureUserDataOverrideFromEnv();
  configureBundledLettaServerEnv();
  initializeAppConfig();
  configureLettaCliPathFromSystem();
}

export function createResidentCoreChannelsRuntimeBundle(
  sessionOwner: ResidentCoreSessionOwner,
): ResidentCoreChannelsRuntimeBundle {
  const runtimeConfig = getResidentCoreLettaBotRuntimeConfig();
  const botConfig = createResidentCoreLettaBotConfig(runtimeConfig);
  const backend = createResidentCoreSessionBackend({
    owner: sessionOwner,
    config: botConfig,
  });
  const lettabotHost = createResidentCoreLettaBotHost({
    config: botConfig,
    backend,
    channels: runtimeConfig.channels,
  });

  return {
    backend,
    lettabotHost,
    runtimeConfig,
  };
}

export const createResidentCoreTelegramRuntimeBundle = createResidentCoreChannelsRuntimeBundle;

export function stopElectronDevelopmentServer(): void {
  if (!isDev()) {
    return;
  }

  try {
    if (process.platform === "win32") {
      execSync(
        `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${DEV_PORT}') do taskkill /PID %a /F`,
        { stdio: "ignore", shell: "cmd.exe" },
      );
    } else {
      execSync(`lsof -ti:${DEV_PORT} | xargs kill -9 2>/dev/null || true`, {
        stdio: "ignore",
      });
    }
  } catch {
    // Process may already be dead.
  }
}

export function stopElectronRuntimeServices(codeIslandMonitor: CodeIslandMonitorHandle | null, lettabotHost: ResidentCoreLettaBotHost | null = null): void {
  codeIslandMonitor?.stop();
  void lettabotHost?.stop();
  stopBundledLettaServer();
}

export function startElectronRuntimeServices(lettabotBackend: SessionBackend): ElectronRuntimeServices {
  const lettabotRuntimeConfig = getResidentCoreLettaBotRuntimeConfig();
  const serverTrace = createTraceContext({ turnId: createTurnId() });

  runtimeLog({
    level: "info",
    message: "bundled server startup requested",
    trace_id: serverTrace.traceId,
    turn_id: serverTrace.turnId,
  });

  void ensureBundledLettaServerStarted(serverTrace)
    .then((startup) => {
      if (startup.status !== "unsupported") {
        runtimeLog({
          level: "info",
          message: "bundled server startup resolved",
          trace_id: serverTrace.traceId,
          turn_id: serverTrace.turnId,
          data: {
            status: startup.status,
            resolutionSource: startup.resolution?.source,
            baseUrl: startup.resolution?.baseUrl,
          },
        });
      }
    })
    .catch((error) => {
      runtimeLog({
        level: "error",
        message: "bundled server startup failed",
        trace_id: serverTrace.traceId,
        turn_id: serverTrace.turnId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
    });

  const codeIslandTrace = createTraceContext({ turnId: createTurnId() });
  const codeIslandStartup = ensureCodeIslandStarted(undefined, {
    trace: codeIslandTrace,
  });
  const codeIslandMonitor = startCodeIslandMonitor(undefined, {
    trace: codeIslandTrace,
  });
  const lettabotHost = createResidentCoreLettaBotHost({
    config: createResidentCoreLettaBotConfig(lettabotRuntimeConfig),
    backend: lettabotBackend,
    channels: lettabotRuntimeConfig.channels,
  });

  runtimeLog({
    level: "info",
    decision_id: TG_RUNTIME_START_001,
    message: "resident-core lettabot host startup requested",
    trace_id: serverTrace.traceId,
    turn_id: serverTrace.turnId,
    data: summarizeResidentCoreChannelsRuntimeConfig(lettabotRuntimeConfig),
  });

  void lettabotHost.start().catch((error) => {
    runtimeLog({
      level: "error",
      decision_id: TG_RUNTIME_START_003,
      error_code: E_TELEGRAM_RUNTIME_START_FAILED,
      message: "resident-core lettabot startup failed",
      trace_id: serverTrace.traceId,
      turn_id: serverTrace.turnId,
      data: {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
  });
  runtimeLog({
    level: "info",
    decision_id: TG_RUNTIME_START_002,
    message: "resident-core lettabot host startup dispatched",
    trace_id: serverTrace.traceId,
    turn_id: serverTrace.turnId,
    data: summarizeResidentCoreChannelsRuntimeConfig(lettabotRuntimeConfig),
  });

  if (codeIslandStartup.status === "launched" && codeIslandStartup.resolution) {
    console.log(
      `[codeisland] Launched ${codeIslandStartup.resolution.source} app at ${codeIslandStartup.resolution.appPath}`,
    );
  } else if (codeIslandStartup.status === "already-running") {
    console.log("[codeisland] Already running; skipping startup launch.");
  } else if (codeIslandStartup.status === "unsupported") {
    console.warn("[codeisland] CodeIsland is unsupported on this macOS version. Skipping startup launch.");
  } else if (codeIslandStartup.status === "missing") {
    console.warn("[codeisland] CodeIsland.app was not found. Skipping startup launch.");
  } else if (codeIslandStartup.status === "failed") {
    console.warn("[codeisland] CodeIsland launch failed. Letta will continue without the companion app.");
  }

  return {
    codeIslandMonitor,
    lettabotHost,
  };
}
