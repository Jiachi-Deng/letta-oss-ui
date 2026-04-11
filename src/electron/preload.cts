import electron from "electron";
import type { ResidentCoreChannelsConfig } from "./libs/config.js";
import type { ClientEvent, ServerEvent } from "./types.js";

electron.contextBridge.exposeInMainWorld("electron", {
    subscribeStatistics: (callback) =>
        ipcOn("statistics", stats => {
            callback(stats);
        }),
    getStaticData: () => ipcInvoke("getStaticData"),
    
    // Letta Agent IPC APIs
    sendClientEvent: (event: ClientEvent) => {
        electron.ipcRenderer.send("client-event", event);
    },
    onServerEvent: (callback: (event: ServerEvent) => void) => {
        const cb = (_: Electron.IpcRendererEvent, payload: string) => {
            try {
                const event = JSON.parse(payload) as ServerEvent;
                callback(event);
            } catch (error) {
                console.error("Failed to parse server event:", error);
            }
        };
        electron.ipcRenderer.on("server-event", cb);
        return () => electron.ipcRenderer.off("server-event", cb);
    },

    getRecentCwds: (limit?: number) => 
        ipcInvoke("get-recent-cwds", limit),
    getAppConfig: () =>
        ipcInvoke("get-app-config"),
    listDiagnosticSummaries: () =>
        ipcInvoke("list-diagnostic-summaries"),
    getDiagnosticSummary: (traceId: string) =>
        ipcInvoke("get-diagnostic-summary", traceId),
    getLatestDiagnosticSummaryForSession: (sessionId: string) =>
        ipcInvoke("get-latest-diagnostic-summary-for-session", sessionId),
    saveAppConfig: (config: {
        connectionType?: "letta-server" | "anthropic-compatible" | "openai-compatible";
        LETTA_BASE_URL?: string;
        LETTA_API_KEY?: string;
        model?: string;
        residentCore?: {
            channels?: ResidentCoreChannelsConfig | null;
        };
    }) =>
        ipcInvoke("save-app-config", config),
    selectDirectory: () => 
        ipcInvoke("select-directory")
} satisfies Window['electron'])

function ipcInvoke<Key extends keyof EventPayloadMapping>(key: Key, ...args: any[]): Promise<EventPayloadMapping[Key]> {
    return electron.ipcRenderer.invoke(key, ...args);
}

function ipcOn<Key extends keyof EventPayloadMapping>(key: Key, callback: (payload: EventPayloadMapping[Key]) => void) {
    const cb = (_: Electron.IpcRendererEvent, payload: any) => callback(payload)
    electron.ipcRenderer.on(key, cb);
    return () => electron.ipcRenderer.off(key, cb)
}
