type Statistics = {
    cpuUsage: number;
    ramUsage: number;
    storageData: number;
}

type StaticData = {
    totalStorage: number;
    cpuModel: string;
    totalMemoryGB: number;
    codeIsland?: {
        platformSupported: boolean;
        available: boolean;
        status: "unsupported" | "missing" | "already-running" | "launched" | "restarted";
        running: boolean;
        resolution?: {
            appPath: string;
            source: "bundled" | "dev-build" | "applications";
        };
    };
}

type AppConfigState = {
    mode: "development" | "packaged";
    source:
        | "dev-env"
        | "dev-env-fallback"
        | "process-env"
        | "packaged-config"
        | "packaged-config-default"
        | "packaged-config-invalid";
    path?: string;
    config: {
        connectionType: "letta-server" | "anthropic-compatible" | "openai-compatible";
        LETTA_BASE_URL: string;
        LETTA_API_KEY?: string;
        model?: string;
    };
    canEdit: boolean;
    requiresOnboarding: boolean;
}

type UnsubscribeFunction = () => void;

type EventPayloadMapping = {
    statistics: Statistics;
    getStaticData: StaticData;
    "get-app-config": AppConfigState;
    "save-app-config": AppConfigState;
    "generate-session-title": string;
    "get-recent-cwds": string[];
    "select-directory": string | null;
}

interface Window {
    electron: {
        subscribeStatistics: (callback: (statistics: Statistics) => void) => UnsubscribeFunction;
        getStaticData: () => Promise<StaticData>;
        // Letta Agent IPC APIs
        sendClientEvent: (event: any) => void;
        onServerEvent: (callback: (event: any) => void) => UnsubscribeFunction;
        getRecentCwds: (limit?: number) => Promise<string[]>;
        getAppConfig: () => Promise<AppConfigState>;
        saveAppConfig: (config: {
            connectionType?: "letta-server" | "anthropic-compatible" | "openai-compatible";
            LETTA_BASE_URL?: string;
            LETTA_API_KEY?: string;
            model?: string;
        }) => Promise<AppConfigState>;
        selectDirectory: () => Promise<string | null>;
    }
}
