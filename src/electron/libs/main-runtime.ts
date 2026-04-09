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

const PRODUCT_NAME = "Letta";
const APP_ID = "com.jachi.letta";

export type ElectronRuntimeServices = {
  codeIslandMonitor: CodeIslandMonitorHandle | null;
};

function configureRuntimeIdentity(): void {
  app.setName(PRODUCT_NAME);

  if (process.platform === "win32") {
    app.setAppUserModelId(APP_ID);
  }
}

function configureLettaCliPathFromSystem(): void {
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
  void ensureBundledLettaServerStarted()
    .then((startup) => {
      if (startup.status !== "unsupported") {
        console.log(`[letta-server] Startup status: ${startup.status}`);
      }
    })
    .catch((error) => {
      console.error("[letta-server] Failed to start bundled server:", error);
    });

  const codeIslandStartup = ensureCodeIslandStarted();
  const codeIslandMonitor = startCodeIslandMonitor();

  if (codeIslandStartup.status === "launched" && codeIslandStartup.resolution) {
    console.log(
      `[codeisland] Launched ${codeIslandStartup.resolution.source} app at ${codeIslandStartup.resolution.appPath}`,
    );
  } else if (codeIslandStartup.status === "already-running") {
    console.log("[codeisland] Already running; skipping startup launch.");
  } else if (codeIslandStartup.status === "missing") {
    console.warn("[codeisland] CodeIsland.app was not found. Skipping startup launch.");
  }

  return {
    codeIslandMonitor,
  };
}
