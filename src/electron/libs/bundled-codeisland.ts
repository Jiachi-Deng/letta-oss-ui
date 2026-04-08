import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import electron from "electron";

const CODEISLAND_APP_NAME = "CodeIsland.app";
const CODEISLAND_EXECUTABLE_MATCH = "CodeIsland.app/Contents/MacOS/CodeIsland";
const APPLICATIONS_CODEISLAND_PATH = "/Applications/CodeIsland.app";
const { app } = electron;

type CodeIslandResolutionSource = "bundled" | "dev-build" | "applications";
type CodeIslandStartupStatus =
  | "unsupported"
  | "missing"
  | "already-running"
  | "launched"
  | "restarted";

export type CodeIslandRuntimeContext = {
  appPath: string;
  cwd: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  resourcesPath: string;
};

export type CodeIslandAppResolution = {
  appPath: string;
  source: CodeIslandResolutionSource;
};

export type CodeIslandStartupResult = {
  status: CodeIslandStartupStatus;
  resolution?: CodeIslandAppResolution;
};

export type CodeIslandMonitorHandle = {
  stop: () => void;
};

export type CodeIslandRuntimeStatus = {
  platformSupported: boolean;
  available: boolean;
  status: CodeIslandStartupStatus;
  running: boolean;
  resolution?: CodeIslandAppResolution;
};

const CODEISLAND_MONITOR_INTERVAL_MS = 5000;
let latestRuntimeStatus: CodeIslandRuntimeStatus = {
  platformSupported: process.platform === "darwin",
  available: false,
  status: process.platform === "darwin" ? "missing" : "unsupported",
  running: false,
};

function getRuntimeContext(): CodeIslandRuntimeContext {
  return {
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
  };
}

function getDevelopmentBuildCandidates(context: CodeIslandRuntimeContext): string[] {
  return [
    path.resolve(context.appPath, "..", "code-island", ".build", "release", CODEISLAND_APP_NAME),
    path.resolve(context.appPath, "..", "code-island", ".build", "arm64-apple-macosx", "release", CODEISLAND_APP_NAME),
    path.resolve(context.appPath, "..", "code-island", ".build", "x86_64-apple-macosx", "release", CODEISLAND_APP_NAME),
    path.resolve(context.cwd, "..", "code-island", ".build", "release", CODEISLAND_APP_NAME),
    path.resolve(context.cwd, "..", "code-island", ".build", "arm64-apple-macosx", "release", CODEISLAND_APP_NAME),
    path.resolve(context.cwd, "..", "code-island", ".build", "x86_64-apple-macosx", "release", CODEISLAND_APP_NAME),
    path.resolve(context.cwd, "code-island", ".build", "release", CODEISLAND_APP_NAME),
    path.resolve(context.cwd, "code-island", ".build", "arm64-apple-macosx", "release", CODEISLAND_APP_NAME),
    path.resolve(context.cwd, "code-island", ".build", "x86_64-apple-macosx", "release", CODEISLAND_APP_NAME),
  ];
}

function dedupeResolutions(resolutions: CodeIslandAppResolution[]): CodeIslandAppResolution[] {
  const seenPaths = new Set<string>();
  const uniqueResolutions: CodeIslandAppResolution[] = [];

  for (const resolution of resolutions) {
    if (seenPaths.has(resolution.appPath)) continue;
    seenPaths.add(resolution.appPath);
    uniqueResolutions.push(resolution);
  }

  return uniqueResolutions;
}

export function getCodeIslandCandidates(context: CodeIslandRuntimeContext = getRuntimeContext()): CodeIslandAppResolution[] {
  if (context.platform !== "darwin") return [];

  if (context.isPackaged) {
    return [
      {
        appPath: path.join(context.resourcesPath, CODEISLAND_APP_NAME),
        source: "bundled",
      },
    ];
  }

  const developmentCandidates: CodeIslandAppResolution[] = getDevelopmentBuildCandidates(context).map((appPath) => ({
    appPath,
    source: "dev-build",
  }));

  return dedupeResolutions([
    ...developmentCandidates,
    {
      appPath: APPLICATIONS_CODEISLAND_PATH,
      source: "applications",
    },
  ]);
}

export function resolveCodeIslandApp(context: CodeIslandRuntimeContext = getRuntimeContext()): CodeIslandAppResolution | null {
  return getCodeIslandCandidates(context).find((candidate) => existsSync(candidate.appPath)) ?? null;
}

function setLatestRuntimeStatus(status: CodeIslandRuntimeStatus): CodeIslandRuntimeStatus {
  latestRuntimeStatus = status;
  return status;
}

export function isCodeIslandRunning(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "darwin") return false;

  const result = spawnSync("pgrep", ["-f", CODEISLAND_EXECUTABLE_MATCH], {
    stdio: "ignore",
  });

  if (result.error) {
    console.warn(`[codeisland] Failed to inspect running processes: ${result.error.message}`);
    return false;
  }

  if (result.status === 0) return true;
  if (result.status === 1) return false;

  console.warn(`[codeisland] Unexpected pgrep exit status while checking CodeIsland: ${result.status ?? "null"}`);
  return false;
}

function launchCodeIsland(appPath: string): void {
  const child = spawn("open", [appPath], {
    detached: true,
    stdio: "ignore",
  });

  child.on("error", (error) => {
    console.warn(`[codeisland] Failed to launch ${appPath}: ${error.message}`);
  });

  child.unref();
}

export function getCodeIslandRuntimeStatus(
  context: CodeIslandRuntimeContext = getRuntimeContext(),
): CodeIslandRuntimeStatus {
  if (context.platform !== "darwin") {
    return setLatestRuntimeStatus({
      platformSupported: false,
      available: false,
      status: "unsupported",
      running: false,
    });
  }

  const resolution = resolveCodeIslandApp(context);
  if (!resolution) {
    return setLatestRuntimeStatus({
      platformSupported: true,
      available: false,
      status: "missing",
      running: false,
    });
  }

  const running = isCodeIslandRunning(context.platform);
  return setLatestRuntimeStatus({
    platformSupported: true,
    available: true,
    status: running ? "already-running" : "missing",
    running,
    resolution,
  });
}

export function ensureCodeIslandStarted(context: CodeIslandRuntimeContext = getRuntimeContext()): CodeIslandStartupResult {
  if (context.platform !== "darwin") {
    setLatestRuntimeStatus({
      platformSupported: false,
      available: false,
      status: "unsupported",
      running: false,
    });
    return { status: "unsupported" };
  }

  const resolution = resolveCodeIslandApp(context);

  if (!resolution) {
    setLatestRuntimeStatus({
      platformSupported: true,
      available: false,
      status: "missing",
      running: false,
    });
    return { status: "missing" };
  }

  if (isCodeIslandRunning(context.platform)) {
    setLatestRuntimeStatus({
      platformSupported: true,
      available: true,
      status: "already-running",
      running: true,
      resolution,
    });
    return {
      status: "already-running",
      resolution,
    };
  }

  launchCodeIsland(resolution.appPath);
  setLatestRuntimeStatus({
    platformSupported: true,
    available: true,
    status: "launched",
    running: true,
    resolution,
  });

  return {
    status: "launched",
    resolution,
  };
}

export function startCodeIslandMonitor(
  context: CodeIslandRuntimeContext = getRuntimeContext(),
): CodeIslandMonitorHandle {
  if (context.platform !== "darwin") {
    setLatestRuntimeStatus({
      platformSupported: false,
      available: false,
      status: "unsupported",
      running: false,
    });
    return {
      stop: () => {},
    };
  }

  const timer = setInterval(() => {
    const resolution = resolveCodeIslandApp(context);

    if (!resolution) {
      setLatestRuntimeStatus({
        platformSupported: true,
        available: false,
        status: "missing",
        running: false,
      });
      return;
    }

    if (isCodeIslandRunning(context.platform)) {
      setLatestRuntimeStatus({
        platformSupported: true,
        available: true,
        status: "already-running",
        running: true,
        resolution,
      });
      return;
    }

    console.warn(`[codeisland] CodeIsland is not running. Restarting ${resolution.appPath}`);
    launchCodeIsland(resolution.appPath);
    setLatestRuntimeStatus({
      platformSupported: true,
      available: true,
      status: "restarted",
      running: true,
      resolution,
    });
  }, CODEISLAND_MONITOR_INTERVAL_MS);

  return {
    stop: () => clearInterval(timer),
  };
}
