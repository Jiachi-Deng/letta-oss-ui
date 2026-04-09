import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const rootArgIndex = args.findIndex((arg) => arg === "--root");
const rootPath = rootArgIndex >= 0
  ? path.resolve(args[rootArgIndex + 1] ?? "")
  : path.resolve(process.cwd(), "build-resources", "LettaServer");

const pythonHome = path.join(rootPath, "python-base", "Python.framework", "Versions", "3.11");
const pythonPath = path.join(rootPath, "venv", "bin", "python3");
const nltkDataPath = path.join(rootPath, "nltk_data");
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

const tmpHome = mkdtempSync(path.join(os.tmpdir(), "letta-smoke-home."));
const tmpLetta = mkdtempSync(path.join(os.tmpdir(), "letta-smoke-letta."));
const port = 18000 + Math.floor(Math.random() * 1000);

const baseEnv = {
  ...process.env,
  PYTHONHOME: pythonHome,
  HOME: tmpHome,
  LETTA_DIR: tmpLetta,
  NLTK_DATA: nltkDataPath,
  PYTHONDONTWRITEBYTECODE: "1",
};

function cleanup() {
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpLetta, { recursive: true, force: true });
}

async function stopServer() {
  if (!server) return;
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function runInit() {
  await new Promise((resolve, reject) => {
    const child = spawn(pythonPath, ["-B", "-c", initScript], {
      env: baseEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`schema init failed with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function waitForHealth() {
  for (let i = 0; i < 120; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const result = spawnSync("curl", ["-sf", `http://127.0.0.1:${port}/v1/health/`], {
      encoding: "utf8",
    });
    if (result.status === 0) {
      return result.stdout.trim();
    }
  }
  throw new Error("timed out waiting for /v1/health/");
}

let server;
let serverStderr = "";
let serverStdout = "";

try {
  await runInit();
  console.log("schema-init-ok");

  server = spawn(
    pythonPath,
    ["-B", "-c", "from letta.main import app; app()", "server", "--host", "127.0.0.1", "--port", String(port)],
    {
      env: baseEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  server.stderr.on("data", (chunk) => {
    serverStderr += chunk.toString();
  });
  server.stdout.on("data", (chunk) => {
    serverStdout += chunk.toString();
  });
  server.on("error", (error) => {
    throw error;
  });

  const health = await waitForHealth();
  console.log(health);

  await stopServer();
  cleanup();
} catch (error) {
  await stopServer();
  cleanup();
  const details = serverStderr.trim();
  const stdoutDetails = serverStdout.trim();
  console.error(`[smoke-letta-server] ${error instanceof Error ? error.message : String(error)}`);
  if (stdoutDetails) {
    console.error(stdoutDetails);
  }
  if (details) {
    console.error(details);
  }
  process.exit(1);
}
