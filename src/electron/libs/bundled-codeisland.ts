import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import electron from "electron";

const CODEISLAND_APP_NAME = "CodeIsland.app";
const CODEISLAND_EXECUTABLE_MATCH = "CodeIsland.app/Contents/MacOS/CodeIsland";
const APPLICATIONS_CODEISLAND_PATH = "/Applications/CodeIsland.app";
const CODEISLAND_MONITOR_INTERVAL_MS = 5000;
const CODEISLAND_LAUNCH_VERIFY_DELAY_MS = 1200;
const CODEISLAND_MINIMUM_MACOS_MAJOR = 14;
const { app } = electron;

type CodeIslandResolutionSource = "bundled" | "dev-build" | "applications";
type CodeIslandStartupStatus =
  | "unsupported"
  | "missing"
  | "already-running"
  | "launched"
  | "restarted"
  | "failed";

export type CodeIslandDiagnostic = {
  code: "missing-bundle" | "macos-version-too-old" | "launch-command-failed" | "launch-verification-failed";
  summary: string;
  detail?: string;
  action?: string;
};

export type CodeIslandRuntimeContext = {
  appPath: string;
  cwd: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  resourcesPath: string;
  systemVersion?: string;
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
  minimumMacOSVersion?: string;
  systemVersion?: string;
  diagnostic?: CodeIslandDiagnostic;
  lastError?: string;
};

let latestRuntimeStatus: CodeIslandRuntimeStatus = {
  platformSupported: process.platform === "darwin",
  available: false,
  status: process.platform === "darwin" ? "missing" : "unsupported",
  running: false,
};

function readMacOSSystemVersion(): string | undefined {
  if (process.platform !== "darwin") return undefined;

  const result = spawnSync("sw_vers", ["-productVersion"], {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status === 0) {
    return result.stdout.trim() || undefined;
  }

  return undefined;
}

function getRuntimeContext(): CodeIslandRuntimeContext {
  return {
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    systemVersion: readMacOSSystemVersion(),
  };
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function getMacOSMajorVersion(systemVersion?: string): number | null {
  if (!systemVersion) return null;
  const major = Number.parseInt(systemVersion.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

function isCodeIslandPlatformSupported(context: CodeIslandRuntimeContext): boolean {
  if (context.platform !== "darwin") return false;
  const major = getMacOSMajorVersion(context.systemVersion);
  return major === null || major >= CODEISLAND_MINIMUM_MACOS_MAJOR;
}

function buildUnsupportedDiagnostic(context: CodeIslandRuntimeContext): CodeIslandDiagnostic {
  if (context.platform !== "darwin") {
    return {
      code: "macos-version-too-old",
      summary: "CodeIsland only runs on macOS.",
      action: "Letta chat will keep working, but the CodeIsland companion is unavailable on this platform.",
    };
  }

  return {
    code: "macos-version-too-old",
    summary: `CodeIsland requires macOS ${CODEISLAND_MINIMUM_MACOS_MAJOR}+ but this Mac is running macOS ${context.systemVersion ?? "unknown"}.`,
    action: "Update the machine to macOS 14 or later to enable the CodeIsland companion. Letta chat will keep working without it.",
  };
}

function getLaunchFailureAction(appPath: string): string {
  return `Open "${appPath}" once in Finder or run 'open "${appPath}"', approve any macOS security prompt in System Settings > Privacy & Security, then relaunch Letta.`;
}

function readQuarantineState(appPath: string): string | null {
  const result = spawnSync("xattr", ["-p", "com.apple.quarantine", appPath], {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status === 0) {
    return result.stdout.trim() || "present";
  }

  return null;
}

function buildMissingDiagnostic(): CodeIslandDiagnostic {
  return {
    code: "missing-bundle",
    summary: "Bundled CodeIsland.app is missing from this build.",
    action: "Letta chat will keep working, but the CodeIsland companion is unavailable in this package.",
  };
}

function buildLaunchFailureDiagnostic(appPath: string, lastError?: string): CodeIslandDiagnostic {
  const quarantine = readQuarantineState(appPath);

  if (quarantine) {
    return {
      code: "launch-verification-failed",
      summary: "CodeIsland was found but macOS appears to be blocking its first launch.",
      detail: lastError || `The bundled companion still has a quarantine attribute (${quarantine}).`,
      action: getLaunchFailureAction(appPath),
    };
  }

  return {
    code: lastError ? "launch-command-failed" : "launch-verification-failed",
    summary: "CodeIsland was found but did not stay running after launch.",
    detail: lastError
      || `Letta attempted to launch the bundled companion at ${appPath}, but it was not running after ${CODEISLAND_LAUNCH_VERIFY_DELAY_MS}ms.`,
    action: getLaunchFailureAction(appPath),
  };
}

function getMinimumMacOSVersionLabel(): string {
  return `${CODEISLAND_MINIMUM_MACOS_MAJOR}.0`;
}

function getDevelopmentBuildCandidates(context: CodeIslandRuntimeContext): string[] {
  const workspaceRoot = path.resolve(context.appPath, "../../..");
  return [
    path.resolve(workspaceRoot, "vendor", "code-island", ".build", "release", CODEISLAND_APP_NAME),
    path.resolve(workspaceRoot, "vendor", "code-island", ".build", "arm64-apple-macosx", "release", CODEISLAND_APP_NAME),
    path.resolve(workspaceRoot, "vendor", "code-island", ".build", "x86_64-apple-macosx", "release", CODEISLAND_APP_NAME),
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

function buildUnsupportedRuntimeStatus(context: CodeIslandRuntimeContext): CodeIslandRuntimeStatus {
  return {
    platformSupported: false,
    available: false,
    status: "unsupported",
    running: false,
    minimumMacOSVersion: getMinimumMacOSVersionLabel(),
    systemVersion: context.systemVersion,
    diagnostic: buildUnsupportedDiagnostic(context),
  };
}

function buildMissingRuntimeStatus(context: CodeIslandRuntimeContext): CodeIslandRuntimeStatus {
  return {
    platformSupported: true,
    available: false,
    status: "missing",
    running: false,
    minimumMacOSVersion: getMinimumMacOSVersionLabel(),
    systemVersion: context.systemVersion,
    diagnostic: buildMissingDiagnostic(),
  };
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

function verifyRunningAndSetFailure(
  resolution: CodeIslandAppResolution,
  context: CodeIslandRuntimeContext,
  status: CodeIslandStartupStatus,
  lastError?: string,
): CodeIslandStartupResult {
  const diagnostic = buildLaunchFailureDiagnostic(resolution.appPath, lastError);
  setLatestRuntimeStatus({
    platformSupported: true,
    available: true,
    status,
    running: false,
    resolution,
    minimumMacOSVersion: getMinimumMacOSVersionLabel(),
    systemVersion: context.systemVersion,
    diagnostic,
    lastError: lastError || diagnostic.detail,
  });
  return { status, resolution };
}

export function getCodeIslandRuntimeStatus(
  context: CodeIslandRuntimeContext = getRuntimeContext(),
): CodeIslandRuntimeStatus {
  if (!isCodeIslandPlatformSupported(context)) {
    return setLatestRuntimeStatus(buildUnsupportedRuntimeStatus(context));
  }

  const resolution = resolveCodeIslandApp(context);
  if (!resolution) {
    return setLatestRuntimeStatus(buildMissingRuntimeStatus(context));
  }

  const running = isCodeIslandRunning(context.platform);
  return setLatestRuntimeStatus({
    platformSupported: true,
    available: true,
    status: running ? "already-running" : latestRuntimeStatus.status === "failed" ? "failed" : "missing",
    running,
    resolution,
    minimumMacOSVersion: getMinimumMacOSVersionLabel(),
    systemVersion: context.systemVersion,
    diagnostic: running ? undefined : latestRuntimeStatus.status === "failed" ? latestRuntimeStatus.diagnostic : undefined,
    lastError: running ? undefined : latestRuntimeStatus.status === "failed" ? latestRuntimeStatus.lastError : undefined,
  });
}

export function ensureCodeIslandStarted(context: CodeIslandRuntimeContext = getRuntimeContext()): CodeIslandStartupResult {
  if (!isCodeIslandPlatformSupported(context)) {
    setLatestRuntimeStatus(buildUnsupportedRuntimeStatus(context));
    return { status: "unsupported" };
  }

  const resolution = resolveCodeIslandApp(context);

  if (!resolution) {
    setLatestRuntimeStatus(buildMissingRuntimeStatus(context));
    return { status: "missing" };
  }

  if (isCodeIslandRunning(context.platform)) {
    setLatestRuntimeStatus({
      platformSupported: true,
      available: true,
      status: "already-running",
      running: true,
      resolution,
      minimumMacOSVersion: getMinimumMacOSVersionLabel(),
      systemVersion: context.systemVersion,
    });
    return {
      status: "already-running",
      resolution,
    };
  }

  const launchResult = spawnSync("open", [resolution.appPath], {
    encoding: "utf8",
    stdio: "pipe",
  });

  const launchError = launchResult.error?.message
    || (launchResult.status !== 0
      ? (launchResult.stderr || launchResult.stdout || `open exited with status ${launchResult.status}`).trim()
      : undefined);

  if (launchError) {
    return verifyRunningAndSetFailure(resolution, context, "failed", launchError);
  }

  sleep(CODEISLAND_LAUNCH_VERIFY_DELAY_MS);

  if (!isCodeIslandRunning(context.platform)) {
    return verifyRunningAndSetFailure(resolution, context, "failed");
  }

  setLatestRuntimeStatus({
    platformSupported: true,
    available: true,
    status: "launched",
    running: true,
    resolution,
    minimumMacOSVersion: getMinimumMacOSVersionLabel(),
    systemVersion: context.systemVersion,
  });

  return {
    status: "launched",
    resolution,
  };
}

export function startCodeIslandMonitor(
  context: CodeIslandRuntimeContext = getRuntimeContext(),
): CodeIslandMonitorHandle {
  if (!isCodeIslandPlatformSupported(context)) {
    setLatestRuntimeStatus(buildUnsupportedRuntimeStatus(context));
    return {
      stop: () => {},
    };
  }

  const timer = setInterval(() => {
    const resolution = resolveCodeIslandApp(context);

    if (!resolution) {
      setLatestRuntimeStatus(buildMissingRuntimeStatus(context));
      return;
    }

    if (isCodeIslandRunning(context.platform)) {
      setLatestRuntimeStatus({
        platformSupported: true,
        available: true,
        status: "already-running",
        running: true,
        resolution,
        minimumMacOSVersion: getMinimumMacOSVersionLabel(),
        systemVersion: context.systemVersion,
      });
      return;
    }

    console.warn(`[codeisland] CodeIsland is not running. Restarting ${resolution.appPath}`);
    const restartResult = ensureCodeIslandStarted(context);

    if (restartResult.status === "launched" || restartResult.status === "already-running") {
      setLatestRuntimeStatus({
        platformSupported: true,
        available: true,
        status: "restarted",
        running: true,
        resolution,
        minimumMacOSVersion: getMinimumMacOSVersionLabel(),
        systemVersion: context.systemVersion,
      });
      return;
    }

    if (restartResult.status === "failed") {
      console.warn(`[codeisland] Failed to restart ${resolution.appPath}`);
    }
  }, CODEISLAND_MONITOR_INTERVAL_MS);

  return {
    stop: () => clearInterval(timer),
  };
}
