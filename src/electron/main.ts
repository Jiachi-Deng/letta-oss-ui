import { app, BrowserWindow, ipcMain, dialog, globalShortcut, Menu } from "electron"
import { ipcMainHandle, isDev, DEV_PORT } from "./util.js";
import { getPreloadPath, getUIPath, getIconPath } from "./pathResolver.js";
import { getStaticData, pollResources, stopPolling } from "./test.js";
import { handleClientEvent, cleanupAllSessions } from "./ipc-handlers.js";
import type { ClientEvent } from "./types.js";
import { getAppConfigState, saveAppConfig } from "./libs/config.js";
import {
    getBundledLettaServerRuntimeStatus,
} from "./libs/bundled-letta-server.js";
import {
    initializeDiagnosticsPersistence,
    flushDiagnosticsPersistence,
    listDiagnosticSummaries,
    getDiagnosticSummary,
    getLatestDiagnosticSummaryForSession,
} from "./libs/diagnostics.js";
import {
    getCodeIslandRuntimeStatus,
    type CodeIslandMonitorHandle,
} from "./libs/bundled-codeisland.js";
import {
    bootstrapElectronRuntime,
    stopElectronDevelopmentServer,
    stopElectronRuntimeServices,
    startElectronRuntimeServices,
} from "./libs/main-runtime.js";

bootstrapElectronRuntime();

let cleanupComplete = false;
let mainWindow: BrowserWindow | null = null;
let codeIslandMonitor: CodeIslandMonitorHandle | null = null;

function cleanup(): void {
    if (cleanupComplete) return;
    cleanupComplete = true;

    globalShortcut.unregisterAll();
    flushDiagnosticsPersistence();
    stopPolling();
    stopElectronRuntimeServices(codeIslandMonitor);
    codeIslandMonitor = null;
    cleanupAllSessions();
    stopElectronDevelopmentServer();
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

    initializeDiagnosticsPersistence(app.getPath("userData"));
    const runtimeServices = startElectronRuntimeServices();
    codeIslandMonitor = runtimeServices.codeIslandMonitor;

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

    ipcMainHandle("get-diagnostic-summary", (_event, traceId: string) => {
        return getDiagnosticSummary(traceId);
    });

    ipcMainHandle("list-diagnostic-summaries", () => {
        return listDiagnosticSummaries();
    });

    ipcMainHandle("get-latest-diagnostic-summary-for-session", (_event, sessionId: string) => {
        return getLatestDiagnosticSummaryForSession(sessionId);
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
