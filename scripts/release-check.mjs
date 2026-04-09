import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const lettaUiRoot = path.resolve(scriptDir, "..");

const args = process.argv.slice(2);
const appArgIndex = args.findIndex((arg) => arg === "--app");
const appPath = appArgIndex >= 0
  ? path.resolve(args[appArgIndex + 1] ?? "")
  : path.join(lettaUiRoot, "dist", "mac-arm64", "Letta.app");

const resourcesRoot = path.join(appPath, "Contents", "Resources");
const serverRoot = path.join(resourcesRoot, "LettaServer");
const codeIslandApp = path.join(resourcesRoot, "CodeIsland.app");
const cliPath = path.join(resourcesRoot, "app.asar.unpacked", "node_modules", "@letta-ai", "letta-code", "letta.js");
const pythonHome = path.join(serverRoot, "python-base", "Python.framework", "Versions", "3.11");
const pythonPath = path.join(serverRoot, "venv", "bin", "python3");
const nltkDataPath = path.join(serverRoot, "nltk_data");
const pyvenvPath = path.join(serverRoot, "venv", "pyvenv.cfg");
const defaultConfigPath = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Letta",
  "config.json",
);

function normalizeModelName(model) {
  const trimmed = model.trim();
  const slashIndex = trimmed.indexOf("/");
  return slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
}

function loadReleaseConfig() {
  const configPath = process.env.LETTA_RELEASE_CONFIG_PATH || defaultConfigPath;
  if (!existsSync(configPath)) {
    fail(`Missing release config at ${configPath}`);
  }
  const parsed = JSON.parse(readFileSync(configPath, "utf8"));
  const connectionType = parsed.connectionType || "letta-server";
  const baseUrl = parsed.LETTA_BASE_URL;
  const apiKey = parsed.LETTA_API_KEY;
  const model = parsed.model;

  if (connectionType !== "letta-server") {
    if (!baseUrl || !apiKey || !model) {
      fail(`Release config at ${configPath} is missing compatible mode fields`);
    }
  }

  return { configPath, connectionType, baseUrl, apiKey, model };
}

function getCompatibleProviderSpec(connectionType, model) {
  const normalizedModel = normalizeModelName(model);
  if (connectionType === "anthropic-compatible") {
    if (/^MiniMax-/i.test(normalizedModel)) {
      return {
        providerToken: "minimax",
        modelHandle: `lc-minimax/${normalizedModel}`,
      };
    }
    return {
      providerToken: "anthropic",
      modelHandle: `lc-anthropic/${normalizedModel}`,
    };
  }

  return {
    providerToken: "openai",
    modelHandle: `lc-openai/${normalizedModel}`,
  };
}
function fail(message) {
  console.error(`[release-check] ${message}`);
  process.exit(1);
}

function safeRemove(targetPath) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOTEMPTY" || attempt === 4) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function logSection(title) {
  console.log(`\n[release-check] ${title}`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });

  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

function ensureNoMutableData(rootPath) {
  const violations = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of readdirSync(current)) {
      const entryPath = path.join(current, entry);
      const stats = lstatSync(entryPath);

      if (stats.isDirectory()) {
        if (entry === "__pycache__") {
          violations.push(entryPath);
          continue;
        }
        if (current === rootPath && (entry.startsWith("server-home") || entry === "logs")) {
          violations.push(entryPath);
          continue;
        }
        stack.push(entryPath);
        continue;
      }

      if (entry.endsWith(".db") || entry.endsWith(".pyc") || entry.endsWith(".pyo")) {
        violations.push(entryPath);
      }
    }
  }

  if (violations.length > 0) {
    fail(`Found mutable or bytecode artifacts in bundle:\n${violations.slice(0, 20).join("\n")}`);
  }
}

async function runBundleHealthSmoke() {
  const releaseConfig = loadReleaseConfig();
  const tmpHome = mkdtempSync(path.join(os.tmpdir(), "letta-release-home."));
  const tmpLetta = mkdtempSync(path.join(os.tmpdir(), "letta-release-letta."));
  const tmpCwd = mkdtempSync(path.join(os.tmpdir(), "letta-release-cwd."));
  const port = 18500 + Math.floor(Math.random() * 500);
  const initScript = `
import asyncio
from letta.orm import Base
from letta.server.db import engine

async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    print("schema-init-ok")

asyncio.run(main())
  `.trim();

  const env = {
    ...process.env,
    PYTHONHOME: pythonHome,
    NLTK_DATA: nltkDataPath,
    HOME: tmpHome,
    LETTA_DIR: tmpLetta,
    PYTHONDONTWRITEBYTECODE: "1",
  };

  let server;
  let stderr = "";

  const stopServer = async () => {
    if (!server || server.exitCode !== null) return;
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 5000);
      server.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  };

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(pythonPath, ["-B", "-c", initScript], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let initStderr = "";
      child.stderr.on("data", (chunk) => {
        initStderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`schema init failed with code ${code}: ${initStderr.trim()}`));
      });
    });

    server = spawn(
      pythonPath,
      ["-B", "-c", "from letta.main import app; app()", "server", "--host", "127.0.0.1", "--port", String(port)],
      {
        env,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    server.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    let health = "";
    for (let i = 0; i < 120; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = spawnSync("curl", ["-sf", `http://127.0.0.1:${port}/v1/health/`], {
        encoding: "utf8",
      });
      if (result.status === 0) {
        health = result.stdout.trim();
        break;
      }
    }

    if (!health) {
      throw new Error(`timed out waiting for /v1/health/\n${stderr.trim()}`);
    }

    console.log(`[release-check] bundle health ${health}`);

    let chatModel = releaseConfig.model ?? "letta/default";
    if (releaseConfig.connectionType !== "letta-server") {
      const compatibleProvider = getCompatibleProviderSpec(
        releaseConfig.connectionType,
        releaseConfig.model,
      );
      const connect = spawnSync(process.execPath, [
        cliPath,
        "connect",
        compatibleProvider.providerToken,
        "--api-key",
        releaseConfig.apiKey,
        "--base-url",
        releaseConfig.baseUrl,
      ], {
        cwd: tmpCwd,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: tmpHome,
          LETTA_DIR: tmpLetta,
          LETTA_BASE_URL: `http://127.0.0.1:${port}`,
          LETTA_API_KEY: "local-dev-key",
          LETTA_CLI_PATH: cliPath,
        },
        stdio: "pipe",
        timeout: 60000,
      });

      if (connect.status !== 0) {
        throw new Error(`compatible provider bootstrap failed:\n${connect.stderr || connect.stdout}`);
      }

      chatModel = compatibleProvider.modelHandle;
      console.log(`[release-check] registered provider ${compatibleProvider.providerToken} for ${chatModel}`);
    }

    let chatOutput = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const chat = spawnSync(process.execPath, [
        cliPath,
        "--new",
        "--yolo",
        "-m",
        chatModel,
        "-p",
        "你好，请用一句中文介绍你自己。",
        "--output-format",
        "json",
      ], {
        cwd: tmpCwd,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: tmpHome,
          LETTA_DIR: tmpLetta,
          LETTA_BASE_URL: `http://127.0.0.1:${port}`,
          LETTA_API_KEY: "local-dev-key",
          LETTA_CLI_PATH: cliPath,
        },
        stdio: "pipe",
        timeout: 60000,
      });

      if (chat.status !== 0) {
        throw new Error(`packaged CLI chat smoke failed:\n${chat.stderr || chat.stdout}`);
      }

      chatOutput = chat.stdout.trim();
      if (!chatOutput) {
        throw new Error(`packaged CLI chat smoke produced no output:\n${chat.stderr || "(no stderr)"}`);
      }

      let parsed;
      try {
        parsed = JSON.parse(chatOutput);
      } catch (error) {
        throw new Error(`packaged CLI chat smoke returned invalid JSON:\n${chatOutput}\n${error}`);
      }

      const resultText = typeof parsed.result === "string" ? parsed.result.trim() : "";
      if (parsed.subtype === "success" && resultText && resultText !== "No assistant response found") {
        break;
      }

      if (attempt === 3) {
        throw new Error(`packaged CLI chat smoke returned an empty assistant result after retries:\n${chatOutput}`);
      }

      console.warn(`[release-check] chat smoke attempt ${attempt} returned no assistant text, retrying`);
      sleep(1000);
    }

    console.log(`[release-check] chat smoke ${chatOutput}`);
    await stopServer();
  } finally {
    await stopServer();
    safeRemove(tmpCwd);
    safeRemove(tmpHome);
    safeRemove(tmpLetta);
  }
}

if (!existsSync(appPath)) fail(`Missing app bundle at ${appPath}`);
if (!existsSync(serverRoot)) fail(`Missing bundled LettaServer at ${serverRoot}`);
if (!existsSync(codeIslandApp)) fail(`Missing bundled CodeIsland app at ${codeIslandApp}`);
if (!existsSync(cliPath)) fail(`Missing bundled Letta CLI at ${cliPath}`);
if (!existsSync(pythonPath)) fail(`Missing bundled python runtime at ${pythonPath}`);

logSection("Running staged runtime verify");
run(process.execPath, [path.join(scriptDir, "verify-letta-server.mjs")], { cwd: lettaUiRoot });

logSection("Checking bundle layout");
const pyvenv = readFileSync(pyvenvPath, "utf8");
if (pyvenv.includes("/opt/homebrew/") || pyvenv.includes("build-resources/") || pyvenv.includes(lettaUiRoot)) {
  fail(`pyvenv.cfg still leaks machine/build paths:\n${pyvenv}`);
}
const otool = run("otool", ["-L", pythonPath]);
if (otool.includes("/opt/homebrew/")) {
  fail(`Bundled python still references Homebrew runtime paths:\n${otool}`);
}
ensureNoMutableData(serverRoot);

logSection("Running bundle health + chat smoke");
await runBundleHealthSmoke();

const appSize = run("du", ["-sh", appPath]).split(/\s+/)[0];
const serverSize = run("du", ["-sh", serverRoot]).split(/\s+/)[0];
console.log(`\n[release-check] OK: ${appPath}`);
console.log(`[release-check] sizes app=${appSize} LettaServer=${serverSize}`);
