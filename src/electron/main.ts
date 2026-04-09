import { app, BrowserWindow, ipcMain, dialog, globalShortcut, Menu } from "electron"
import { execSync } from "child_process";
import { ipcMainHandle, isDev, DEV_PORT } from "./util.js";
import { getPreloadPath, getUIPath, getIconPath } from "./pathResolver.js";
import { getStaticData, pollResources, stopPolling } from "./test.js";
import { handleClientEvent, cleanupAllSessions } from "./ipc-handlers.js";
import type { ClientEvent } from "./types.js";
import { getAppConfigState, initializeAppConfig, saveAppConfig } from "./libs/config.js";
import {
    configureBundledLettaServerEnv,
    ensureBundledLettaServerStarted,
    getBundledLettaServerRuntimeStatus,
    stopBundledLettaServer,
} from "./libs/bundled-letta-server.js";
import {
    ensureCodeIslandStarted,
    getCodeIslandRuntimeStatus,
    startCodeIslandMonitor,
    type CodeIslandMonitorHandle,
} from "./libs/bundled-codeisland.js";

const PRODUCT_NAME = "Letta";
const APP_ID = "com.jachi.letta";

configureRuntimeIdentity();
configureBundledLettaServerEnv();
initializeAppConfig();

function configureRuntimeIdentity(): void {
    app.setName(PRODUCT_NAME);

    if (process.platform === "win32") {
        app.setAppUserModelId(APP_ID);
    }
}

// Find letta CLI
try {
  const whichCmd = process.platform === 'win32' ? 'where letta' : 'which letta';
  const lettaPath = execSync(whichCmd, { encoding: "utf-8" }).trim();
  if (lettaPath) {
    // On Windows, 'where' may return multiple lines - take the first one
    const firstPath = lettaPath.split('\n')[0].trim();
    process.env.LETTA_CLI_PATH = firstPath;
    console.log("Found letta CLI at:", firstPath);
  }
} catch (e) {
  console.warn("Could not find letta CLI:", e);
}

let cleanupComplete = false;
let mainWindow: BrowserWindow | null = null;
let codeIslandMonitor: CodeIslandMonitorHandle | null = null;

function killViteDevServer(): void {
    if (!isDev()) return;
    try {
        if (process.platform === 'win32') {
            execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${DEV_PORT}') do taskkill /PID %a /F`, { stdio: 'ignore', shell: 'cmd.exe' });
        } else {
            execSync(`lsof -ti:${DEV_PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
        }
    } catch {
        // Process may already be dead
    }
}

function cleanup(): void {
    if (cleanupComplete) return;
    cleanupComplete = true;

    globalShortcut.unregisterAll();
    stopPolling();
    codeIslandMonitor?.stop();
    codeIslandMonitor = null;
    stopBundledLettaServer();
    cleanupAllSessions();
    killViteDevServer();
}

function handleSignal(): void {
    cleanup();
    app.quit();
}

// Initialize everything when app is ready
app.on("ready", () => {
    Menu.setApplicationMenu(null);
    // Setup event handlers
    app.on("before-quit", cleanup);
    app.on("will-quit", cleanup);
    app.on("window-all-closed", () => {
        cleanup();
        app.quit();
    });

    process.on("SIGTERM", handleSignal);
    process.on("SIGINT", handleSignal);
    process.on("SIGHUP", handleSignal);

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
    codeIslandMonitor = startCodeIslandMonitor();
    if (codeIslandStartup.status === "launched" && codeIslandStartup.resolution) {
        console.log(`[codeisland] Launched ${codeIslandStartup.resolution.source} app at ${codeIslandStartup.resolution.appPath}`);
    } else if (codeIslandStartup.status === "already-running") {
        console.log("[codeisland] Already running; skipping startup launch.");
    } else if (codeIslandStartup.status === "missing") {
        console.warn("[codeisland] CodeIsland.app was not found. Skipping startup launch.");
    }

    // Create main window
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        webPreferences: {
            preload: getPreloadPath(),
        },
        icon: getIconPath(),
        titleBarStyle: "hiddenInset",
        backgroundColor: "#FAF9F6",
        trafficLightPosition: { x: 15, y: 18 }
    });

    if (isDev()) mainWindow.loadURL(`http://localhost:${DEV_PORT}`)
    else mainWindow.loadFile(getUIPath());

    globalShortcut.register('CommandOrControl+Q', () => {
        cleanup();
        app.quit();
    });

    pollResources(mainWindow);

    ipcMainHandle("getStaticData", () => {
        return getStaticData(getCodeIslandRuntimeStatus(), getBundledLettaServerRuntimeStatus());
    });

    ipcMainHandle("get-app-config", () => {
        return getAppConfigState();
    });

    ipcMainHandle("save-app-config", (_event, config) => {
        return saveAppConfig(config);
    });

    // Handle client events
    ipcMain.on("client-event", (_: Electron.IpcMainEvent, event: ClientEvent) => {
        handleClientEvent(event);
    });

    // Handle recent cwds request (simplified - no local storage)
    ipcMainHandle("get-recent-cwds", () => {
        return [process.cwd()]; // Just return current directory
    });

    // Handle directory selection
    ipcMainHandle("select-directory", async () => {
        const result = await dialog.showOpenDialog(mainWindow!, {
            properties: ['openDirectory']
        });

        if (result.canceled) {
            return null;
        }

        return result.filePaths[0];
    });
})
