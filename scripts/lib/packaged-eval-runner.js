import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function normalizeModelName(model) {
  const trimmed = String(model ?? "").trim();
  const slashIndex = trimmed.indexOf("/");
  return slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
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

function safeRemove(targetPath) {
  rmSync(targetPath, { recursive: true, force: true });
}

function stopServer(server) {
  if (!server || server.exitCode !== null) return Promise.resolve();
  server.kill("SIGTERM");
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${result.stderr || result.stdout || "(no output)"}`);
  }
}

export function loadAppConfig(configPath) {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function resolvePresetRuntimeConfig(configPreset, appConfig) {
  const preset = configPreset ?? "unknown";
  const base = {
    connectionType: appConfig.connectionType ?? "letta-server",
    baseUrl: appConfig.LETTA_BASE_URL,
    apiKey: appConfig.LETTA_API_KEY,
    model: appConfig.model,
  };

  if (preset === "letta-server") {
    return {
      connectionType: "letta-server",
      baseUrl: appConfig.LETTA_BASE_URL,
      apiKey: appConfig.LETTA_API_KEY,
      model: appConfig.model ?? "letta/default",
    };
  }

  if (preset === "compatible-minimax") {
    if (!base.model || !/minimax/i.test(base.model)) {
      throw new Error(`configPreset=${preset} requires a MiniMax model in app config`);
    }
    return {
      ...base,
      connectionType: "anthropic-compatible",
    };
  }

  if (preset === "compatible-anthropic") {
    return {
      ...base,
      connectionType: "anthropic-compatible",
    };
  }

  if (preset === "compatible-openai") {
    return {
      ...base,
      connectionType: "openai-compatible",
    };
  }

  return base;
}

function extractFirstMessage(evalCase) {
  const sendStep = (evalCase.steps ?? []).find((step) => step.action === "send_message");
  if (!sendStep || typeof sendStep.value !== "string" || sendStep.value.trim().length === 0) {
    throw new Error(`eval case ${evalCase.id} does not define a send_message step`);
  }
  return sendStep.value;
}

async function runSchemaInit({ pythonPath, env }) {
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

  await new Promise((resolve, reject) => {
    const child = spawn(pythonPath, ["-B", "-c", initScript], {
      env,
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

async function waitForHealth(port) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await wait(1000);
    const result = spawnSync("curl", ["-sf", `http://127.0.0.1:${port}/v1/health/`], {
      encoding: "utf8",
    });
    if (result.status === 0) {
      return result.stdout.trim();
    }
  }
  throw new Error("timed out waiting for bundled server healthcheck");
}

async function runSdkFirstMessage({
  appExecutable,
  resourcesRoot,
  evalCase,
  chatModel,
  cwd,
  tmpDir,
  env,
  cliPath,
  localBaseUrl,
}) {
  const scriptPath = path.join(tmpDir, "run-sdk-first-message.mjs");
  const sdkPath = path.join(resourcesRoot, "app.asar", "node_modules", "@letta-ai", "letta-code-sdk", "dist", "index.js");
  const message = extractFirstMessage(evalCase);

  const script = `
import { pathToFileURL } from "node:url";

const sdkPath = process.argv[2];
const model = process.argv[3];
const cwd = process.argv[4];
const message = process.argv[5];

const { createSession } = await import(pathToFileURL(sdkPath).href);
const session = createSession(undefined, {
  model,
  permissionMode: "bypassPermissions",
  cwd,
  canUseTool: async () => ({ behavior: "allow" }),
});

try {
  const result = await session.runTurn(message);
  if (!result.success) {
    throw new Error(result.errorDetail || result.errorCode || result.error || "runTurn failed");
  }
  console.log(JSON.stringify({ ok: true, text: result.result ?? "" }));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
} finally {
  try { session.close(); } catch {}
}
  `.trim();

  writeFileSync(scriptPath, script, "utf8");

  const result = spawnSync(appExecutable, [scriptPath, sdkPath, chatModel, cwd, message], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      LETTA_BASE_URL: localBaseUrl,
      LETTA_API_KEY: "local-dev-key",
      LETTA_CLI_PATH: cliPath,
    },
    cwd,
    timeout: 90000,
  });

  ensureSuccess(result, `packaged SDK first-message run for ${evalCase.id}`);

  const payloadLine = result.stdout.split(/\r?\n/).find((line) => line.trim().startsWith("{"));
  if (!payloadLine) {
    throw new Error(`packaged SDK first-message run produced no JSON payload:\n${result.stdout}\n${result.stderr}`);
  }

  const payload = JSON.parse(payloadLine);
  if (!payload.ok || typeof payload.text !== "string" || payload.text.trim().length === 0) {
    throw new Error(`packaged SDK first-message run produced an empty assistant response:\n${payloadLine}`);
  }

  return {
    text: payload.text,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function runPackagedDesktopEvalCase({
  evalCase,
  appPath,
  configPath,
  reportPath,
}) {
  const startedAt = new Date().toISOString();
  const resourcesRoot = path.join(appPath, "Contents", "Resources");
  const appExecutable = path.join(appPath, "Contents", "MacOS", "Letta");
  const cliPath = path.join(resourcesRoot, "app.asar.unpacked", "node_modules", "@letta-ai", "letta-code", "letta.js");
  const serverRoot = path.join(resourcesRoot, "LettaServer");
  const pythonHome = path.join(serverRoot, "python-base", "Python.framework", "Versions", "3.11");
  const pythonPath = path.join(serverRoot, "venv", "bin", "python3");
  const nltkDataPath = path.join(serverRoot, "nltk_data");
  const runtimeConfig = resolvePresetRuntimeConfig(evalCase.setup?.configPreset, loadAppConfig(configPath));
  const tmpHome = mkdtempSync(path.join(os.tmpdir(), "letta-eval-home."));
  const tmpLetta = mkdtempSync(path.join(os.tmpdir(), "letta-eval-letta."));
  const tmpCwd = mkdtempSync(path.join(os.tmpdir(), "letta-eval-cwd."));
  const tmpWork = mkdtempSync(path.join(os.tmpdir(), "letta-eval-work."));
  const port = 18600 + Math.floor(Math.random() * 500);
  const env = {
    ...process.env,
    PYTHONHOME: pythonHome,
    HOME: tmpHome,
    LETTA_DIR: tmpLetta,
    NLTK_DATA: nltkDataPath,
    PYTHONDONTWRITEBYTECODE: "1",
  };

  let server = null;
  let serverStderr = "";
  let providerRegistration = null;
  let healthPayload = null;
  let sdkRun = null;
  let status = "failed";
  let errorMessage = null;

  try {
    await runSchemaInit({ pythonPath, env });

    server = spawn(
      pythonPath,
      ["-B", "-c", "from letta.main import app; app()", "server", "--host", "127.0.0.1", "--port", String(port)],
      {
        env,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    server.stderr.on("data", (chunk) => {
      serverStderr += chunk.toString();
    });

    healthPayload = await waitForHealth(port);

    let chatModel = runtimeConfig.model ?? "letta/default";
    if (runtimeConfig.connectionType !== "letta-server") {
      const compatibleProvider = getCompatibleProviderSpec(runtimeConfig.connectionType, runtimeConfig.model);
      const connect = spawnSync(process.execPath, [
        cliPath,
        "connect",
        compatibleProvider.providerToken,
        "--api-key",
        runtimeConfig.apiKey,
        "--base-url",
        runtimeConfig.baseUrl,
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

      ensureSuccess(connect, `provider bootstrap for ${evalCase.id}`);
      providerRegistration = {
        providerToken: compatibleProvider.providerToken,
        modelHandle: compatibleProvider.modelHandle,
      };
      chatModel = compatibleProvider.modelHandle;
    }

    sdkRun = await runSdkFirstMessage({
      appExecutable,
      resourcesRoot,
      evalCase,
      chatModel,
      cwd: evalCase.setup?.workingDir ?? tmpWork,
      tmpDir: tmpWork,
      env: {
        HOME: tmpHome,
        LETTA_DIR: tmpLetta,
      },
      cliPath,
      localBaseUrl: `http://127.0.0.1:${port}`,
    });

    status = "passed";
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    await stopServer(server);
    safeRemove(tmpWork);
    safeRemove(tmpCwd);
    safeRemove(tmpHome);
    safeRemove(tmpLetta);
  }

  const report = {
    schemaVersion: 1,
    caseId: evalCase.id,
    surface: evalCase.surface,
    mode: evalCase.mode,
    status,
    startedAt,
    endedAt: new Date().toISOString(),
    appPath,
    configPath,
    environment: {
      configPreset: evalCase.setup?.configPreset ?? null,
      providerRegistration,
      bundledHealth: healthPayload,
    },
    result: {
      assistantText: sdkRun?.text ?? null,
      stdout: sdkRun?.stdout ?? null,
      stderr: sdkRun?.stderr ?? null,
      serverStderr: serverStderr || null,
    },
    assertions: {
      mustNotHaveErrorCodes: evalCase.expect?.diagnostics?.mustNotHaveErrorCodes ?? [],
      mustNotHaveFirstFailedDecisionIds: evalCase.expect?.diagnostics?.mustNotHaveFirstFailedDecisionIds ?? [],
      uiMustContainText: evalCase.expect?.ui?.mustContainText ?? [],
    },
    failure: status === "passed" ? null : {
      message: errorMessage,
    },
  };

  if (reportPath) {
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (status !== "passed") {
    throw new Error(errorMessage ?? `packaged eval case failed: ${evalCase.id}`);
  }

  return report;
}
