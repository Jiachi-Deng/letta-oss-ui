import { spawn, type ChildProcess } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { app } from "electron";

const DEFAULT_PACKAGED_SERVER_PORT = 18383;
const DEFAULT_DEVELOPMENT_SERVER_PORT = 8283;
const STARTUP_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 750;
const LOCAL_SERVER_API_KEY = "local-dev-key";
const SERVER_INIT_TIMEOUT_MS = 30_000;

export type BundledLettaServerResolution = {
  pythonPath: string;
  pythonHome?: string;
  nltkDataPath?: string;
  rootPath: string;
  source: "bundled" | "build-resource" | "dev-venv";
  baseUrl: string;
};

export type BundledLettaServerRuntimeStatus = {
  platformSupported: boolean;
  available: boolean;
  running: boolean;
  ready: boolean;
  status:
    | "unsupported"
    | "missing"
    | "starting"
    | "ready"
    | "already-running"
    | "failed";
  baseUrl: string;
  resolution?: BundledLettaServerResolution;
  pid?: number;
  lastError?: string;
};

type StartupResult = {
  status: BundledLettaServerRuntimeStatus["status"];
  resolution?: BundledLettaServerResolution;
};

let serverProcess: ChildProcess | null = null;
let stoppingServer = false;
let runtimeStatus: BundledLettaServerRuntimeStatus = {
  platformSupported: process.platform === "darwin" && process.arch === "arm64",
  available: false,
  running: false,
  ready: false,
  status: process.platform === "darwin" && process.arch === "arm64" ? "missing" : "unsupported",
  baseUrl: getBundledLettaServerUrl(),
};
let startupPromise: Promise<StartupResult> | null = null;

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBundledServerPort(): number {
  const explicit = process.env.LETTA_LOCAL_SERVER_PORT?.trim();
  const parsed = explicit ? Number.parseInt(explicit, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return app.isPackaged ? DEFAULT_PACKAGED_SERVER_PORT : DEFAULT_DEVELOPMENT_SERVER_PORT;
}

export function getBundledLettaServerUrl(): string {
  const explicit =
    process.env.LETTA_LOCAL_SERVER_URL?.trim() ||
    process.env.LOCAL_LETTA_SERVER_URL?.trim();
  if (explicit) {
    return normalizeUrl(explicit);
  }

  return `http://127.0.0.1:${getBundledServerPort()}`;
}

function getServerLogPath(): string | null {
  if (!app.isReady()) return null;

  const logsDir = path.join(app.getPath("userData"), "logs");
  mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, "bundled-letta-server.log");
}

function logServerLine(prefix: string, line: string): void {
  const logPath = getServerLogPath();
  if (!logPath) return;
  appendFileSync(logPath, `[${new Date().toISOString()}] ${prefix}${line}\n`);
}

function getBundledServerHomeDir(): string {
  if (!app.isReady()) {
    throw new Error("Bundled Letta server home cannot be resolved before Electron app is ready.");
  }

  const serverHome = path.join(app.getPath("userData"), "server-home");
  mkdirSync(serverHome, { recursive: true });
  return serverHome;
}

function getBundledServerDataDir(): string {
  const dataDir = path.join(getBundledServerHomeDir(), ".letta");
  mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function getBundledServerDbPath(): string {
  return path.join(getBundledServerDataDir(), "letta.db");
}

function resolveCandidate(source: BundledLettaServerResolution["source"], rootPath: string): BundledLettaServerResolution | null {
  const pythonPath = path.join(rootPath, "venv", "bin", "python3");
  if (!existsSync(pythonPath)) return null;
  const pythonHome = path.join(rootPath, "python-base", "Python.framework", "Versions", "3.11");
  const nltkDataPath = path.join(rootPath, "nltk_data");

  return {
    pythonPath,
    pythonHome: existsSync(pythonHome) ? pythonHome : undefined,
    nltkDataPath: existsSync(nltkDataPath) ? nltkDataPath : undefined,
    rootPath,
    source,
    baseUrl: getBundledLettaServerUrl(),
  };
}

export function resolveBundledLettaServer(): BundledLettaServerResolution | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const lettaUiRoot = path.resolve(moduleDir, "../../..");
  const repoRoot = path.resolve(lettaUiRoot, "..");
  const candidates: Array<[BundledLettaServerResolution["source"], string]> = [
    ["bundled", path.join(process.resourcesPath, "LettaServer")],
    ["build-resource", path.join(lettaUiRoot, "build-resources", "LettaServer")],
    ["build-resource", path.join(process.cwd(), "build-resources", "LettaServer")],
    ["dev-venv", path.join(repoRoot, "venv")],
    ["dev-venv", path.join(process.cwd(), "venv")],
  ];

  for (const [source, candidateRoot] of candidates) {
    const resolution = source === "dev-venv"
      ? (() => {
          const pythonPath = path.join(candidateRoot, "bin", "python3");
          if (!existsSync(pythonPath)) return null;
          return {
            pythonPath,
            pythonHome: undefined,
            rootPath: candidateRoot,
            source,
            baseUrl: getBundledLettaServerUrl(),
          } satisfies BundledLettaServerResolution;
        })()
      : resolveCandidate(source, candidateRoot);

    if (resolution) {
      return resolution;
    }
  }

  return null;
}

async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/v1/health/`);
    return response.ok;
  } catch {
    return false;
  }
}

function syncRuntimeStatus(
  partial: Partial<BundledLettaServerRuntimeStatus>,
): BundledLettaServerRuntimeStatus {
  runtimeStatus = {
    ...runtimeStatus,
    ...partial,
    baseUrl: partial.baseUrl ?? runtimeStatus.baseUrl ?? getBundledLettaServerUrl(),
  };
  return runtimeStatus;
}

export function configureBundledLettaServerEnv(): void {
  process.env.LETTA_LOCAL_SERVER_URL = getBundledLettaServerUrl();
  process.env.LETTA_LOCAL_SERVER_API_KEY = LOCAL_SERVER_API_KEY;
  if (app.isReady()) {
    process.env.LETTA_DIR = getBundledServerDataDir();
  }
}

function buildBundledServerEnv(resolution: BundledLettaServerResolution): NodeJS.ProcessEnv {
  const serverHome = getBundledServerHomeDir();
  const serverDataDir = getBundledServerDataDir();
  const pythonDir = path.dirname(resolution.pythonPath);
  const pythonHomeBin = resolution.pythonHome ? path.join(resolution.pythonHome, "bin") : null;
  const baseUrl = getBundledLettaServerUrl();
  return {
    ...process.env,
    HOME: serverHome,
    LETTA_DIR: serverDataDir,
    PATH: `${[pythonDir, pythonHomeBin, process.env.PATH ?? ""].filter(Boolean).join(":")}`,
    NLTK_DATA: resolution.nltkDataPath ?? process.env.NLTK_DATA,
    PYTHONHOME: resolution.pythonHome ?? process.env.PYTHONHOME,
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    LETTA_LOCAL_SERVER_URL: baseUrl,
    LETTA_LOCAL_SERVER_API_KEY: LOCAL_SERVER_API_KEY,
  };
}

function spawnBundledServer(resolution: BundledLettaServerResolution): ChildProcess {
  const baseUrl = getBundledLettaServerUrl();
  const port = new URL(baseUrl).port || String(getBundledServerPort());

  const child = spawn(
    resolution.pythonPath,
    [
      "-B",
      "-c",
      "from letta.main import app; app()",
      "server",
      "--host",
      "127.0.0.1",
      "--port",
      port,
    ],
    {
      cwd: resolution.rootPath,
      env: buildBundledServerEnv(resolution),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", (chunk) => {
    logServerLine("[stdout] ", chunk.toString().trimEnd());
  });

  child.stderr.on("data", (chunk) => {
    logServerLine("[stderr] ", chunk.toString().trimEnd());
  });

  child.on("exit", (code, signal) => {
    serverProcess = null;
    syncRuntimeStatus({
      running: false,
      ready: false,
      pid: undefined,
      status: stoppingServer ? "ready" : "failed",
      lastError: stoppingServer
        ? undefined
        : `Bundled Letta server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`,
    });
    stoppingServer = false;
  });

  return child;
}

async function initializeBundledServerDatabase(
  resolution: BundledLettaServerResolution,
): Promise<void> {
  if (existsSync(getBundledServerDbPath())) {
    return;
  }

  logServerLine("[init] ", "Initializing bundled Letta server database.");

  const initScript = `
import asyncio
from letta.orm import Base
from letta.server.db import engine

async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()

asyncio.run(main())
`.trim();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      resolution.pythonPath,
      ["-B", "-c", initScript],
      {
        cwd: resolution.rootPath,
        env: buildBundledServerEnv(resolution),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";
    let stdout = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out initializing bundled Letta server database after ${SERVER_INIT_TIMEOUT_MS}ms.`));
    }, SERVER_INIT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      logServerLine("[init-stdout] ", text.trimEnd());
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      logServerLine("[init-stderr] ", text.trimEnd());
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Bundled Letta server database initialization failed with code ${code ?? "null"}.\n${stderr || stdout}`.trim(),
        ),
      );
    });
  });
}

export async function ensureBundledLettaServerStarted(): Promise<StartupResult> {
  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = (async () => {
    const baseUrl = getBundledLettaServerUrl();
    const resolution = resolveBundledLettaServer();

    if (!runtimeStatus.platformSupported) {
      return { status: "unsupported" };
    }

    if (!resolution) {
      syncRuntimeStatus({
        available: false,
        running: false,
        ready: false,
        status: "missing",
        baseUrl,
        lastError: "Bundled Letta server runtime is missing.",
      });
      return { status: "missing" };
    }

    syncRuntimeStatus({
      available: true,
      resolution,
      baseUrl,
    });

    if (await checkHealth(baseUrl)) {
      syncRuntimeStatus({
        running: true,
        ready: true,
        status: "already-running",
        pid: serverProcess?.pid,
      });
      return { status: "already-running", resolution };
    }

    if (!serverProcess) {
      try {
        await initializeBundledServerDatabase(resolution);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        syncRuntimeStatus({
          available: true,
          running: false,
          ready: false,
          status: "failed",
          resolution,
          baseUrl,
          lastError: message,
        });
        throw error;
      }
      serverProcess = spawnBundledServer(resolution);
      syncRuntimeStatus({
        running: true,
        ready: false,
        status: "starting",
        pid: serverProcess.pid,
        resolution,
        baseUrl,
        lastError: undefined,
      });
    }

    return { status: "starting", resolution };
  })();

  try {
    return await startupPromise;
  } finally {
    startupPromise = null;
  }
}

export async function waitForBundledLettaServerReady(timeoutMs = STARTUP_TIMEOUT_MS): Promise<string> {
  const startupResult = await ensureBundledLettaServerStarted();
  const baseUrl = startupResult.resolution?.baseUrl ?? getBundledLettaServerUrl();

  if (startupResult.status === "missing") {
    throw new Error("Bundled Letta server runtime is missing from the packaged app.");
  }

  if (startupResult.status === "unsupported") {
    throw new Error("Bundled Letta server is only supported on macOS Apple Silicon in this build.");
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkHealth(baseUrl)) {
      syncRuntimeStatus({
        running: true,
        ready: true,
        status: startupResult.status === "already-running" ? "already-running" : "ready",
        baseUrl,
      });
      return baseUrl;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  syncRuntimeStatus({
    running: Boolean(serverProcess),
    ready: false,
    status: "failed",
    baseUrl,
    lastError: `Timed out waiting for bundled Letta server at ${baseUrl}`,
  });

  throw new Error(`Bundled Letta server did not become ready within ${timeoutMs}ms.`);
}

export function getBundledLettaServerRuntimeStatus(): BundledLettaServerRuntimeStatus {
  return {
    ...runtimeStatus,
    baseUrl: getBundledLettaServerUrl(),
  };
}

export function stopBundledLettaServer(): void {
  if (!serverProcess) return;

  stoppingServer = true;
  serverProcess.kill("SIGTERM");
  serverProcess = null;
  syncRuntimeStatus({
    running: false,
    ready: false,
    pid: undefined,
  });
}
