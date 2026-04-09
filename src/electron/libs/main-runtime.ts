import { execSync } from "node:child_process";
import { app } from "electron";
import { DEV_PORT, isDev } from "../util.js";
import {
  configureBundledLettaServerEnv,
  ensureBundledLettaServerStarted,
  stopBundledLettaServer,
} from "./bundled-letta-server.js";
import {
  ensureCodeIslandStarted,
  startCodeIslandMonitor,
  type CodeIslandMonitorHandle,
} from "./bundled-codeisland.js";
import { initializeAppConfig } from "./config.js";
import { createComponentLogger, createTraceContext, createTurnId } from "./trace.js";

const PRODUCT_NAME = "Letta";
const APP_ID = "com.jachi.letta";

export type ElectronRuntimeServices = {
  codeIslandMonitor: CodeIslandMonitorHandle | null;
};

const runtimeLog = createComponentLogger("main-runtime");

function configureRuntimeIdentity(): void {
  app.setName(PRODUCT_NAME);

  if (process.platform === "win32") {
    app.setAppUserModelId(APP_ID);
  }
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
  configureBundledLettaServerEnv();
  initializeAppConfig();
  configureLettaCliPathFromSystem();
}

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

export function stopElectronRuntimeServices(codeIslandMonitor: CodeIslandMonitorHandle | null): void {
  codeIslandMonitor?.stop();
  stopBundledLettaServer();
}

export function startElectronRuntimeServices(): ElectronRuntimeServices {
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
          error: String(error),
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
  };
}
