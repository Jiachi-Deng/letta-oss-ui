import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import electron from "electron";
import {
  E_CODEISLAND_BUNDLE_MISSING,
  E_CODEISLAND_LAUNCH_BLOCKED,
  E_CODEISLAND_LAUNCH_COMMAND_FAILED,
  E_CODEISLAND_MONITOR_RESTART_FAILED,
  E_CODEISLAND_OS_UNSUPPORTED,
} from "../../shared/error-codes.js";
import {
  CI_BOOT_001,
  CI_BOOT_002,
  CI_BOOT_003,
  CI_BOOT_004,
  CI_LAUNCH_001,
  CI_LAUNCH_002,
  CI_LAUNCH_003,
  CI_MONITOR_001,
  CI_MONITOR_002,
  CI_MONITOR_003,
  CI_MONITOR_004,
} from "../../shared/decision-ids.js";
import {
  createComponentLogger,
  type TraceContext,
} from "./trace.js";

const CODEISLAND_APP_NAME = "CodeIsland.app";
const CODEISLAND_EXECUTABLE_MATCH = "CodeIsland.app/Contents/MacOS/CodeIsland";
const APPLICATIONS_CODEISLAND_PATH = "/Applications/CodeIsland.app";
const CODEISLAND_MONITOR_INTERVAL_MS = 5000;
const CODEISLAND_LAUNCH_VERIFY_DELAY_MS = 1200;
const CODEISLAND_MINIMUM_MACOS_MAJOR = 14;
const { app } = electron;
const codeIslandLog = createComponentLogger("bundled-codeisland");
const CODEISLAND_OUTPUT_PREVIEW_LIMIT = 200;

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

type CodeIslandObservabilityOptions = {
  trace?: TraceContext;
};

export type CodeIslandRuntimeStatus = {
  platformSupported: boolean;
  available: boolean;
  status: CodeIslandStartupStatus;
  running: boolean;
  traceId?: string;
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

function logCodeIslandEvent(
  trace: TraceContext | undefined,
  input: Parameters<typeof codeIslandLog>[0],
): void {
  if (!trace) return;

  codeIslandLog({
    ...input,
    trace_id: trace.traceId,
    turn_id: trace.turnId,
    session_id: trace.sessionId,
  });
}

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

function summarizeCommandOutput(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  return normalized.length > CODEISLAND_OUTPUT_PREVIEW_LIMIT
    ? `${normalized.slice(0, CODEISLAND_OUTPUT_PREVIEW_LIMIT)}…`
    : normalized;
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
  const candidateRoots = [
    context.appPath,
    path.resolve(context.appPath, ".."),
    path.resolve(context.appPath, "../.."),
    path.resolve(context.appPath, "../../.."),
    context.cwd,
    path.resolve(context.cwd, ".."),
    path.resolve(context.cwd, "../.."),
  ];
  const architectures = ["release", "arm64-apple-macosx/release", "x86_64-apple-macosx/release"];
  const candidates: string[] = [];

  for (const root of candidateRoots) {
    for (const suffix of architectures) {
      candidates.push(path.resolve(root, "vendor", "code-island", ".build", suffix, CODEISLAND_APP_NAME));
      candidates.push(path.resolve(root, "code-island", ".build", suffix, CODEISLAND_APP_NAME));
    }
  }

  return candidates;
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
  latestRuntimeStatus = {
    ...status,
    traceId: status.traceId ?? latestRuntimeStatus.traceId,
  };
  return latestRuntimeStatus;
}

function buildUnsupportedRuntimeStatus(context: CodeIslandRuntimeContext): CodeIslandRuntimeStatus {
  return {
    platformSupported: false,
    available: false,
    status: "unsupported",
    running: false,
    traceId: latestRuntimeStatus.traceId,
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
    traceId: latestRuntimeStatus.traceId,
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
  trace?: TraceContext,
): CodeIslandStartupResult {
  const diagnostic = buildLaunchFailureDiagnostic(resolution.appPath, lastError);
  setLatestRuntimeStatus({
    platformSupported: true,
    available: true,
    status,
    running: false,
    traceId: trace?.traceId,
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
  observability: CodeIslandObservabilityOptions = {},
): CodeIslandRuntimeStatus {
  if (!isCodeIslandPlatformSupported(context)) {
    logCodeIslandEvent(observability.trace, {
      level: "warn",
      message: "CodeIsland platform check failed",
      decision_id: CI_BOOT_002,
      error_code: E_CODEISLAND_OS_UNSUPPORTED,
      data: {
        platform: context.platform,
        systemVersion: context.systemVersion,
      },
    });
    return setLatestRuntimeStatus({
      ...buildUnsupportedRuntimeStatus(context),
      traceId: observability.trace?.traceId,
    });
  }

  const resolution = resolveCodeIslandApp(context);
  if (!resolution) {
    logCodeIslandEvent(observability.trace, {
      level: "warn",
      message: "CodeIsland bundle could not be resolved",
      decision_id: CI_BOOT_001,
      error_code: E_CODEISLAND_BUNDLE_MISSING,
      data: {
        resourcesPath: context.resourcesPath,
        isPackaged: context.isPackaged,
      },
    });
    return setLatestRuntimeStatus({
      ...buildMissingRuntimeStatus(context),
      traceId: observability.trace?.traceId,
    });
  }

  const running = isCodeIslandRunning(context.platform);
  return setLatestRuntimeStatus({
    platformSupported: true,
    available: true,
    status: running ? "already-running" : latestRuntimeStatus.status === "failed" ? "failed" : "missing",
    running,
    traceId: observability.trace?.traceId,
    resolution,
    minimumMacOSVersion: getMinimumMacOSVersionLabel(),
    systemVersion: context.systemVersion,
    diagnostic: running ? undefined : latestRuntimeStatus.status === "failed" ? latestRuntimeStatus.diagnostic : undefined,
    lastError: running ? undefined : latestRuntimeStatus.status === "failed" ? latestRuntimeStatus.lastError : undefined,
  });
}

export function ensureCodeIslandStarted(
  context: CodeIslandRuntimeContext = getRuntimeContext(),
  observability: CodeIslandObservabilityOptions = {},
): CodeIslandStartupResult {
  logCodeIslandEvent(observability.trace, {
    level: "info",
    message: "CodeIsland platform check started",
    decision_id: CI_BOOT_002,
    data: {
      platform: context.platform,
      systemVersion: context.systemVersion,
      minimumMacOSVersion: getMinimumMacOSVersionLabel(),
    },
  });

  if (!isCodeIslandPlatformSupported(context)) {
    logCodeIslandEvent(observability.trace, {
      level: "warn",
      message: "CodeIsland platform check failed",
      decision_id: CI_BOOT_002,
      error_code: E_CODEISLAND_OS_UNSUPPORTED,
      data: {
        platform: context.platform,
        systemVersion: context.systemVersion,
      },
    });
    setLatestRuntimeStatus({
      ...buildUnsupportedRuntimeStatus(context),
      traceId: observability.trace?.traceId,
    });
    return { status: "unsupported" };
  }

  const resolution = resolveCodeIslandApp(context);
  logCodeIslandEvent(observability.trace, {
    level: resolution ? "info" : "warn",
    message: resolution
      ? "CodeIsland bundle resolved"
      : "CodeIsland bundle could not be resolved",
    decision_id: CI_BOOT_001,
    error_code: resolution ? undefined : E_CODEISLAND_BUNDLE_MISSING,
    data: resolution
      ? {
          appPath: resolution.appPath,
          source: resolution.source,
        }
      : {
          resourcesPath: context.resourcesPath,
          isPackaged: context.isPackaged,
        },
  });

  if (!resolution) {
    setLatestRuntimeStatus({
      ...buildMissingRuntimeStatus(context),
      traceId: observability.trace?.traceId,
    });
    return { status: "missing" };
  }

  if (isCodeIslandRunning(context.platform)) {
    logCodeIslandEvent(observability.trace, {
      level: "info",
      message: "CodeIsland already running; skipping launch",
      decision_id: CI_BOOT_003,
      data: {
        appPath: resolution.appPath,
        source: resolution.source,
      },
    });
    setLatestRuntimeStatus({
      platformSupported: true,
      available: true,
      status: "already-running",
      running: true,
      traceId: observability.trace?.traceId,
      resolution,
      minimumMacOSVersion: getMinimumMacOSVersionLabel(),
      systemVersion: context.systemVersion,
    });
    return {
      status: "already-running",
      resolution,
    };
  }

  logCodeIslandEvent(observability.trace, {
    level: "info",
    message: "Launching CodeIsland via open command",
    decision_id: CI_BOOT_003,
    data: {
      appPath: resolution.appPath,
      source: resolution.source,
      },
  });
  logCodeIslandEvent(observability.trace, {
    level: "info",
    message: "CodeIsland launch command started",
    decision_id: CI_LAUNCH_001,
    data: {
      appPath: resolution.appPath,
      source: resolution.source,
      command: "open",
    },
  });
  const launchResult = spawnSync("open", [resolution.appPath], {
    encoding: "utf8",
    stdio: "pipe",
  });

  const launchSummary = {
    appPath: resolution.appPath,
    source: resolution.source,
    command: "open",
    status: launchResult.status,
    signal: launchResult.signal ?? undefined,
    stdoutLength: launchResult.stdout?.length ?? 0,
    stderrLength: launchResult.stderr?.length ?? 0,
    stdoutPreview: launchResult.stdout?.trim()
      ? summarizeCommandOutput(launchResult.stdout)
      : undefined,
    stderrPreview: launchResult.stderr?.trim()
      ? summarizeCommandOutput(launchResult.stderr)
      : undefined,
  };

  logCodeIslandEvent(observability.trace, {
    level: "info",
    message: "CodeIsland launch command completed",
    decision_id: CI_LAUNCH_002,
    data: {
      ...launchSummary,
      error: launchResult.error?.message,
    },
  });

  const launchError = launchResult.error?.message
    || (launchResult.status !== 0
      ? (launchResult.stderr || launchResult.stdout || `open exited with status ${launchResult.status}`).trim()
      : undefined);

  if (launchError) {
    logCodeIslandEvent(observability.trace, {
      level: "error",
      message: "CodeIsland launch command failed",
      decision_id: CI_LAUNCH_003,
      error_code: E_CODEISLAND_LAUNCH_COMMAND_FAILED,
      data: {
        ...launchSummary,
        error: launchError,
      },
    });
    return verifyRunningAndSetFailure(
      resolution,
      context,
      "failed",
      launchError,
      observability.trace,
    );
  }

  sleep(CODEISLAND_LAUNCH_VERIFY_DELAY_MS);

  if (!isCodeIslandRunning(context.platform)) {
    logCodeIslandEvent(observability.trace, {
      level: "warn",
      message: "CodeIsland failed launch verification",
      decision_id: CI_BOOT_004,
      error_code: E_CODEISLAND_LAUNCH_BLOCKED,
      data: {
        appPath: resolution.appPath,
        source: resolution.source,
        verifyDelayMs: CODEISLAND_LAUNCH_VERIFY_DELAY_MS,
      },
    });
    return verifyRunningAndSetFailure(
      resolution,
      context,
      "failed",
      undefined,
      observability.trace,
    );
  }

  logCodeIslandEvent(observability.trace, {
    level: "info",
    message: "CodeIsland launch verified",
    decision_id: CI_BOOT_004,
    data: {
      appPath: resolution.appPath,
      source: resolution.source,
      verifyDelayMs: CODEISLAND_LAUNCH_VERIFY_DELAY_MS,
    },
  });
  setLatestRuntimeStatus({
    platformSupported: true,
    available: true,
    status: "launched",
    running: true,
    traceId: observability.trace?.traceId,
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
  observability: CodeIslandObservabilityOptions = {},
): CodeIslandMonitorHandle {
  if (!isCodeIslandPlatformSupported(context)) {
    setLatestRuntimeStatus({
      ...buildUnsupportedRuntimeStatus(context),
      traceId: observability.trace?.traceId,
    });
    return {
      stop: () => {},
    };
  }

  const timer = setInterval(() => {
    const resolution = resolveCodeIslandApp(context);

    if (!resolution) {
      setLatestRuntimeStatus({
        ...buildMissingRuntimeStatus(context),
        traceId: observability.trace?.traceId,
      });
      return;
    }

    if (isCodeIslandRunning(context.platform)) {
      setLatestRuntimeStatus({
        platformSupported: true,
        available: true,
        status: "already-running",
        running: true,
        traceId: observability.trace?.traceId,
        resolution,
        minimumMacOSVersion: getMinimumMacOSVersionLabel(),
        systemVersion: context.systemVersion,
      });
      return;
    }

    logCodeIslandEvent(observability.trace, {
      level: "warn",
      message: "CodeIsland monitor observed companion not running",
      decision_id: CI_MONITOR_001,
      data: {
        appPath: resolution.appPath,
        source: resolution.source,
      },
    });
    console.warn(`[codeisland] CodeIsland is not running. Restarting ${resolution.appPath}`);
    logCodeIslandEvent(observability.trace, {
      level: "info",
      message: "CodeIsland monitor attempting restart",
      decision_id: CI_MONITOR_002,
      data: {
        appPath: resolution.appPath,
        source: resolution.source,
      },
    });
    const restartResult = ensureCodeIslandStarted(context, observability);

    if (restartResult.status === "launched" || restartResult.status === "already-running") {
      logCodeIslandEvent(observability.trace, {
        level: "info",
        message: "CodeIsland monitor restart succeeded",
        decision_id: CI_MONITOR_003,
        data: {
          appPath: resolution.appPath,
          source: resolution.source,
          restartStatus: restartResult.status,
        },
      });
      setLatestRuntimeStatus({
        platformSupported: true,
        available: true,
        status: "restarted",
        running: true,
        traceId: observability.trace?.traceId,
        resolution,
        minimumMacOSVersion: getMinimumMacOSVersionLabel(),
        systemVersion: context.systemVersion,
      });
      return;
    }

    if (restartResult.status === "failed") {
      logCodeIslandEvent(observability.trace, {
        level: "error",
        message: "CodeIsland monitor restart failed",
        decision_id: CI_MONITOR_004,
        error_code: E_CODEISLAND_MONITOR_RESTART_FAILED,
        data: {
          appPath: resolution.appPath,
          source: resolution.source,
        },
      });
      console.warn(`[codeisland] Failed to restart ${resolution.appPath}`);
    }
  }, CODEISLAND_MONITOR_INTERVAL_MS);

  return {
    stop: () => clearInterval(timer),
  };
}
