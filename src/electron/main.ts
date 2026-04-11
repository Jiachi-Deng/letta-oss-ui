import { app, BrowserWindow, ipcMain, dialog, globalShortcut, Menu } from "electron"
import { join } from "node:path";
import type { SessionBackend } from "lettabot/core/interfaces.js";
import { ipcMainHandle, isDev, DEV_PORT } from "./util.js";
import { getPreloadPath, getUIPath, getIconPath } from "./pathResolver.js";
import { getStaticData, pollResources, stopPolling } from "./test.js";
import { bindResidentCoreService, cleanupAllSessions, handleClientEvent, residentCoreBroadcast } from "./ipc-handlers.js";
import type { ClientEvent } from "./types.js";
import { getAppConfigState, getResidentCoreLettaBotRuntimeConfig, saveAppConfig } from "./libs/config.js";
import type { ResidentCoreLettaBotRuntimeConfig } from "./libs/config.js";
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
import { createResidentCoreTelegramRuntimeBundle } from "./libs/main-runtime.js";
import { createResidentCoreService } from "./libs/resident-core/resident-core.js";
import { createResidentCoreSessionBackend } from "./libs/resident-core/resident-core-session-backend.js";
import { createResidentCoreSessionOwner } from "./libs/resident-core/session-owner.js";
import { createResidentCoreRuntimeHost } from "./libs/resident-core/runtime-host.js";
import { createComponentLogger } from "./libs/trace.js";
import {
    TG_RUNTIME_RELOAD_001,
    TG_RUNTIME_RELOAD_002,
    TG_RUNTIME_RELOAD_003,
    TG_RUNTIME_RELOAD_004,
} from "../shared/decision-ids.js";
import { E_TELEGRAM_RUNTIME_RELOAD_FAILED } from "../shared/error-codes.js";

bootstrapElectronRuntime();

let cleanupComplete = false;
let mainWindow: BrowserWindow | null = null;
let codeIslandMonitor: CodeIslandMonitorHandle | null = null;
let lettabotHost: import("./libs/resident-core/lettabot-host.js").ResidentCoreLettaBotHost | null = null;
let residentCoreSessionOwner: import("./libs/resident-core/session-owner.js").ResidentCoreSessionOwner | null = null;
let residentCoreService: ReturnType<typeof createResidentCoreService> | null = null;
let lettabotBackend: SessionBackend | null = null;
let cleanupPromise: Promise<void> | null = null;
const mainLog = createComponentLogger("main");

function maskTelegramToken(token?: string | null): string | null {
    const trimmedToken = token?.trim();
    if (!trimmedToken) return null;
    return `***${trimmedToken.slice(-4)}`;
}

function summarizeResidentCoreLettaBotRuntimeConfig(
    config: ResidentCoreLettaBotRuntimeConfig,
): Record<string, unknown> {
    const telegram = config.telegram;
    return {
        workingDir: config.workingDir,
        hasToken: Boolean(telegram?.token?.trim()),
        tokenTail: maskTelegramToken(telegram?.token),
        dmPolicy: telegram?.dmPolicy ?? null,
        streaming: telegram?.streaming ?? null,
        telegramWorkingDir: telegram?.workingDir ?? null,
    };
}

async function cleanupRuntime(): Promise<void> {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
        if (cleanupComplete) return;
        cleanupComplete = true;

        globalShortcut.unregisterAll();
        flushDiagnosticsPersistence();
        stopPolling();
        stopElectronRuntimeServices(codeIslandMonitor, lettabotHost);
        codeIslandMonitor = null;
        lettabotHost = null;
        await cleanupAllSessions();
        stopElectronDevelopmentServer();
    })();

    return cleanupPromise;
}

async function reloadResidentCoreTelegramRuntime(): Promise<void> {
    if (!residentCoreSessionOwner || !residentCoreService) {
        throw new Error("Resident Core is not initialized");
    }

    const previousHost = lettabotHost;
    const previousBackend = lettabotBackend;
    const currentCodeIslandMonitor = codeIslandMonitor;
    const nextRuntimeConfig = getResidentCoreLettaBotRuntimeConfig();

    mainLog({
        level: "info",
        decision_id: TG_RUNTIME_RELOAD_001,
        message: "resident core telegram runtime reload requested",
        data: summarizeResidentCoreLettaBotRuntimeConfig(nextRuntimeConfig),
    });

    if (previousHost) {
        await previousHost.stop();
    }

    await residentCoreService.cleanupAllSessions();
    lettabotHost = null;
    lettabotBackend = null;

    const nextRuntime = createResidentCoreTelegramRuntimeBundle(residentCoreSessionOwner);

    try {
        await nextRuntime.lettabotHost.start();
        mainLog({
            level: "info",
            decision_id: TG_RUNTIME_RELOAD_002,
            message: "resident core telegram runtime restart succeeded",
            data: {
                nextWorkingDir: nextRuntime.runtimeConfig.workingDir,
                hasTelegramToken: Boolean(nextRuntime.runtimeConfig.telegram?.token?.trim()),
            },
        });
    } catch (error) {
        mainLog({
            level: "error",
            decision_id: TG_RUNTIME_RELOAD_004,
            error_code: E_TELEGRAM_RUNTIME_RELOAD_FAILED,
            message: "resident core telegram runtime reload failed",
            data: {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            },
        });
        throw error;
    }

    lettabotBackend = nextRuntime.backend;
    lettabotHost = nextRuntime.lettabotHost;
    codeIslandMonitor = currentCodeIslandMonitor;

    mainLog({
        level: "info",
        decision_id: TG_RUNTIME_RELOAD_003,
        message: "resident core telegram runtime reload completed",
        data: {
            previousBackendConfigured: Boolean(previousBackend),
            nextWorkingDir: nextRuntime.runtimeConfig.workingDir,
        },
    });
}

function handleSignal(): void {
    void cleanupRuntime().finally(() => app.exit(0));
}

function createMainWindow(): BrowserWindow {
    const window = new BrowserWindow({
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

    window.on("closed", () => {
        if (mainWindow === window) {
            mainWindow = null;
        }
        stopPolling();
    });

    if (isDev()) window.loadURL(`http://localhost:${DEV_PORT}`)
    else window.loadFile(getUIPath());

    pollResources(window);
    mainWindow = window;
    return window;
}

// Initialize everything when app is ready
app.on("ready", () => {
    Menu.setApplicationMenu(null);
    app.on("before-quit", (event: Electron.Event) => {
        event.preventDefault();
        void cleanupRuntime().finally(() => app.exit(0));
    });
    app.on("will-quit", () => {
        void cleanupRuntime();
    });
    app.on("window-all-closed", ((event: Electron.Event) => {
        event.preventDefault();
        stopPolling();
    }) as any);
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });

    process.on("SIGTERM", handleSignal);
    process.on("SIGINT", handleSignal);
    process.on("SIGHUP", handleSignal);

    initializeDiagnosticsPersistence(app.getPath("userData"));
    residentCoreSessionOwner = createResidentCoreSessionOwner({
        runtimeHost: createResidentCoreRuntimeHost(),
    });
    residentCoreService = createResidentCoreService(residentCoreBroadcast, residentCoreSessionOwner);
    bindResidentCoreService(residentCoreService);
    const lettabotRuntimeConfig = getResidentCoreLettaBotRuntimeConfig();
    mainLog({
        level: "info",
        message: "resident core telegram runtime config read",
        data: summarizeResidentCoreLettaBotRuntimeConfig(lettabotRuntimeConfig),
    });
    const lettabotWorkingDir = lettabotRuntimeConfig.workingDir;
    lettabotBackend = createResidentCoreSessionBackend({
        owner: residentCoreSessionOwner,
        config: {
            workingDir: lettabotWorkingDir,
            allowedTools: [],
            conversationMode: "shared",
            reuseSession: true,
            agentName: "ResidentCoreLettaBot",
            logging: {
                turnLogFile: join(lettabotWorkingDir, "turns.jsonl"),
                maxTurns: 500,
            },
        } as const,
    });
    const runtimeServices = startElectronRuntimeServices(lettabotBackend);
    codeIslandMonitor = runtimeServices.codeIslandMonitor;
    lettabotHost = runtimeServices.lettabotHost;

    globalShortcut.register('CommandOrControl+Q', () => {
        void cleanupRuntime().finally(() => app.exit(0));
    });

    createMainWindow();

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

    ipcMainHandle("save-app-config", async (_event, config) => {
        const nextState = saveAppConfig(config);
        await reloadResidentCoreTelegramRuntime();
        return nextState;
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
