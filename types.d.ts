type DiagnosticSummary = {
    traceId: string;
    turnId?: string;
    sessionId?: string;
    summary: string;
    errorCode?: string;
    lastSuccessfulDecisionId?: string;
    firstFailedDecisionId?: string;
    suggestedAction?: string;
    createdAt?: string;
    updatedAt?: string;
    stepCount?: number;
    steps: Array<{
        component: string;
        decisionId?: string;
        status: "ok" | "warning" | "error";
        message: string;
        errorCode?: string;
        data?: Record<string, unknown>;
    }>;
}

type DiagnosticSummaryListItem = Omit<DiagnosticSummary, "steps">;

type Statistics = {
    cpuUsage: number;
    ramUsage: number;
    storageData: number;
}

type StaticData = {
    totalStorage: number;
    cpuModel: string;
    totalMemoryGB: number;
    lettaServer?: {
        platformSupported: boolean;
        available: boolean;
        running: boolean;
        ready: boolean;
        status: "unsupported" | "missing" | "starting" | "ready" | "already-running" | "failed";
        baseUrl: string;
        resolution?: {
            pythonPath: string;
            rootPath: string;
            source: "bundled" | "build-resource" | "dev-venv";
            baseUrl: string;
        };
        pid?: number;
        lastError?: string;
    };
    codeIsland?: {
        platformSupported: boolean;
        available: boolean;
        status: "unsupported" | "missing" | "already-running" | "launched" | "restarted" | "failed";
        running: boolean;
        minimumMacOSVersion?: string;
        systemVersion?: string;
        resolution?: {
            appPath: string;
            source: "bundled" | "dev-build" | "applications";
        };
        diagnostic?: {
            code: "missing-bundle" | "macos-version-too-old" | "launch-command-failed" | "launch-verification-failed";
            summary: string;
            detail?: string;
            action?: string;
        };
        traceId?: string;
        lastError?: string;
    };
}

type ResidentCoreTelegramStartupConfig = {
    token?: string;
    dmPolicy?: "pairing" | "allowlist" | "open";
    streaming?: boolean;
    workingDir?: string;
}

type ResidentCoreChannelName = "telegram";

type ResidentCoreChannelsConfig = Partial<
    Record<ResidentCoreChannelName, ResidentCoreTelegramStartupConfig | null>
>;

type ResidentCoreConfig = {
    channels?: ResidentCoreChannelsConfig;
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
        residentCore?: ResidentCoreConfig;
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
    "list-diagnostic-summaries": DiagnosticSummaryListItem[];
    "get-diagnostic-summary": DiagnosticSummary | null;
    "get-latest-diagnostic-summary-for-session": DiagnosticSummary | null;
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
        listDiagnosticSummaries: () => Promise<DiagnosticSummaryListItem[]>;
        getDiagnosticSummary: (traceId: string) => Promise<DiagnosticSummary | null>;
        getLatestDiagnosticSummaryForSession: (sessionId: string) => Promise<DiagnosticSummary | null>;
        saveAppConfig: (config: {
            connectionType?: "letta-server" | "anthropic-compatible" | "openai-compatible";
            LETTA_BASE_URL?: string;
            LETTA_API_KEY?: string;
            model?: string;
            residentCore?: ResidentCoreConfig;
        }) => Promise<AppConfigState>;
        selectDirectory: () => Promise<string | null>;
    }
}
