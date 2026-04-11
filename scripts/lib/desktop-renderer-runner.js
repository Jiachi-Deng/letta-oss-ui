import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { loadAppConfig, resolvePresetRuntimeConfig } from "./packaged-eval-runner.js";

const START_SESSION_LABEL = "Start Session";
const START_SESSION_PROMPT_PLACEHOLDER = "Describe the task you want agent to handle...";
const START_SESSION_CWD_PLACEHOLDER = "/path/to/project";
const MAIN_PROMPT_PLACEHOLDER = "Describe what you want agent to handle...";
const SEND_BUTTON_LABEL = "Send prompt";
const SETTINGS_BUTTON_LABEL = "Settings";
const SETTINGS_TITLE = "Letta Settings";
const SAVE_SETTINGS_LABEL = "Save Changes";
const DEFAULT_RENDER_TIMEOUT_MS = 120_000;

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCaseSteps(evalCase) {
  if (!Array.isArray(evalCase.steps) || evalCase.steps.length === 0) {
    throw new Error(`eval case ${evalCase.id} does not define any steps`);
  }
  return evalCase.steps;
}

function findFirstMessage(evalCase) {
  const sendStep = normalizeCaseSteps(evalCase).find((step) => step.action === "send_message");
  if (!sendStep || typeof sendStep.value !== "string" || sendStep.value.trim().length === 0) {
    return null;
  }
  return sendStep.value.trim();
}

export function extractFirstMessage(evalCase) {
  const firstMessage = findFirstMessage(evalCase);
  if (!firstMessage) {
    throw new Error(`eval case ${evalCase.id} does not define a send_message step`);
  }
  return firstMessage;
}

export function buildIsolatedAppConfig({ evalCase, sourceConfig }) {
  const runtimeConfig = resolvePresetRuntimeConfig(evalCase.setup?.configPreset, sourceConfig);
  return {
    connectionType: runtimeConfig.connectionType,
    LETTA_BASE_URL: runtimeConfig.baseUrl,
    LETTA_API_KEY: runtimeConfig.apiKey,
    model: runtimeConfig.model,
    residentCore: {},
  };
}

export function applySeedFiles(workingDir, seedFiles = []) {
  for (const file of seedFiles) {
    if (!file || typeof file !== "object") continue;
    const relativePath = String(file.path ?? "").trim();
    if (!relativePath) continue;
    const targetPath = path.join(workingDir, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, String(file.content ?? ""), "utf8");
  }
}

async function collectRendererDiagnostics(page) {
  return page.evaluate(async () => {
    const summaries = await window.electron.listDiagnosticSummaries();
    const latest = summaries.at(-1) ?? null;
    return {
      summaries,
      latest,
    };
  });
}

async function readGlobalError(page) {
  const copyButtons = page.getByText("Copy diagnostics", { exact: true });
  if (await copyButtons.count() === 0) {
    return null;
  }

  return page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const copyButton = buttons.find((button) => button.textContent?.includes("Copy diagnostics"));
    const container = copyButton?.closest("div");
    return container?.textContent?.replace(/\s+/g, " ").trim() ?? null;
  });
}

async function getAssistantCount(page) {
  return page.getByText("Assistant", { exact: true }).count();
}

async function getVisibleText(page) {
  return page.locator("body").innerText();
}

async function ensureNoGlobalError(page) {
  const globalError = await readGlobalError(page);
  if (globalError) {
    throw new Error(globalError);
  }
}

async function isStartSessionModalOpen(page) {
  try {
    return await page.getByPlaceholder(START_SESSION_CWD_PLACEHOLDER, { exact: true }).isVisible();
  } catch {
    return false;
  }
}

async function waitForAssistantIncrementOrFailure(page, previousAssistantCount, timeoutMs) {
  const started = Date.now();

  for (;;) {
    if (Date.now() - started > timeoutMs) {
      return {
        ok: false,
        reason: `Timed out waiting for assistant response after ${timeoutMs}ms`,
        assistantCount: previousAssistantCount,
      };
    }

    const globalError = await readGlobalError(page);
    if (globalError) {
      return { ok: false, reason: globalError, assistantCount: previousAssistantCount };
    }

    const assistantCount = await getAssistantCount(page);
    if (assistantCount > previousAssistantCount) {
      await page.getByRole("button", { name: SEND_BUTTON_LABEL, exact: true }).waitFor({
        timeout: timeoutMs,
      });
      return {
        ok: true,
        assistantCount,
        bodyText: await getVisibleText(page),
      };
    }

    await wait(500);
  }
}

async function openNewTask(page) {
  if (await isStartSessionModalOpen(page)) {
    return;
  }
  await page.getByRole("button", { name: "+ New Task", exact: true }).click();
  await page.getByPlaceholder(START_SESSION_CWD_PLACEHOLDER, { exact: true }).waitFor({
    timeout: DEFAULT_RENDER_TIMEOUT_MS,
  });
}

async function sendMessage(page, { message, workingDir }) {
  const previousAssistantCount = await getAssistantCount(page);
  const modalOpen = await isStartSessionModalOpen(page);

  if (modalOpen) {
    await page.getByPlaceholder(START_SESSION_CWD_PLACEHOLDER, { exact: true }).fill(workingDir);
    await page.getByPlaceholder(START_SESSION_PROMPT_PLACEHOLDER, { exact: true }).fill(message);
    await page.getByRole("button", { name: START_SESSION_LABEL, exact: true }).click();
    await page.getByPlaceholder(START_SESSION_CWD_PLACEHOLDER, { exact: true }).waitFor({
      state: "hidden",
      timeout: DEFAULT_RENDER_TIMEOUT_MS,
    });
    await page.getByText("User", { exact: true }).waitFor({ timeout: DEFAULT_RENDER_TIMEOUT_MS });
  } else {
    await page.getByPlaceholder(MAIN_PROMPT_PLACEHOLDER, { exact: true }).fill(message);
    await page.getByRole("button", { name: SEND_BUTTON_LABEL, exact: true }).click();
  }

  const outcome = await waitForAssistantIncrementOrFailure(page, previousAssistantCount, DEFAULT_RENDER_TIMEOUT_MS);
  if (!outcome.ok) {
    throw new Error(outcome.reason);
  }

  return outcome;
}

async function assertToolCards(page, { tools, match = "all" }) {
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error("assert_tool_cards requires a non-empty tools array");
  }

  if (match === "any") {
    const started = Date.now();
    for (;;) {
      for (const tool of tools) {
        const locator = page.locator(".tool-use-item").filter({ hasText: String(tool) });
        if ((await locator.count()) > 0) {
          return;
        }
      }
      if (Date.now() - started > DEFAULT_RENDER_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for any tool card: ${tools.join(", ")}`);
      }
      await ensureNoGlobalError(page);
      await wait(500);
    }
  }

  for (const tool of tools) {
    const locator = page.locator(".tool-use-item").filter({ hasText: String(tool) }).first();
    await locator.waitFor({ timeout: DEFAULT_RENDER_TIMEOUT_MS });
  }
}

async function openSettings(page) {
  if (await isStartSessionModalOpen(page)) {
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByPlaceholder(START_SESSION_CWD_PLACEHOLDER, { exact: true }).waitFor({
      state: "hidden",
      timeout: DEFAULT_RENDER_TIMEOUT_MS,
    });
  }
  await page.getByRole("button", { name: SETTINGS_BUTTON_LABEL, exact: true }).click();
  await page.getByText(SETTINGS_TITLE, { exact: true }).waitFor({ timeout: DEFAULT_RENDER_TIMEOUT_MS });
}

async function setConnectionType(page, value) {
  await page.getByLabel("Connection Type").selectOption(String(value));
}

async function setModel(page, value) {
  await page.getByLabel(/Model/).fill(value ?? "");
}

async function setBaseUrl(page, value) {
  await page.getByLabel("Base URL").fill(value ?? "");
}

async function setApiKey(page, value) {
  await page.getByLabel(/API Key/).fill(value ?? "");
}

async function saveSettings(page) {
  await page.getByRole("button", { name: SAVE_SETTINGS_LABEL, exact: true }).click();
}

async function assertVisibleText(page, value) {
  await page.getByText(String(value), { exact: true }).waitFor({ timeout: DEFAULT_RENDER_TIMEOUT_MS });
}

async function closeSettings(page) {
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
}

async function executeStep(page, step, context) {
  switch (step.action) {
    case "launch_app":
    case "launch_app_from_finder":
    case "install_app_to_applications":
    case "complete_onboarding_if_needed":
      return;
    case "new_task":
      await openNewTask(page);
      return;
    case "send_message":
      await sendMessage(page, {
        message: String(step.value ?? ""),
        workingDir: context.workingDir,
      });
      return;
    case "assert_tool_cards":
      await assertToolCards(page, {
        tools: step.tools,
        match: step.match,
      });
      return;
    case "open_settings":
      await openSettings(page);
      return;
    case "set_connection_type":
      await setConnectionType(page, step.value);
      return;
    case "set_model":
      await setModel(page, step.value ?? "");
      return;
    case "set_base_url":
      await setBaseUrl(page, step.value ?? "");
      return;
    case "set_api_key":
      await setApiKey(page, step.value ?? "");
      return;
    case "save_settings":
      await saveSettings(page);
      return;
    case "assert_visible_text":
      await assertVisibleText(page, step.value);
      return;
    case "close_settings":
      await closeSettings(page);
      return;
    default:
      throw new Error(`Unsupported desktop renderer eval action: ${step.action}`);
  }
}

export async function runDesktopRendererEvalCase({
  evalCase,
  appPath,
  configPath,
  reportPath,
}) {
  const startedAt = new Date().toISOString();
  const sourceConfig = loadAppConfig(configPath);
  const isolatedConfig = buildIsolatedAppConfig({ evalCase, sourceConfig });
  const appExecutable = path.join(appPath, "Contents", "MacOS", "Letta");
  const screenshotPath = reportPath.replace(/\.json$/u, ".png");
  const tmpHome = mkdtempSync(path.join(os.tmpdir(), "letta-renderer-home."));
  const tmpUserData = mkdtempSync(path.join(os.tmpdir(), "letta-renderer-userdata."));
  const tmpCwd = mkdtempSync(path.join(os.tmpdir(), "letta-renderer-cwd."));
  const appConfigPath = path.join(tmpUserData, "config.json");
  const workingDir = evalCase.setup?.workingDir ?? tmpCwd;
  const firstMessage = findFirstMessage(evalCase);

  mkdirSync(path.dirname(reportPath), { recursive: true });
  mkdirSync(workingDir, { recursive: true });
  applySeedFiles(workingDir, evalCase.setup?.seedFiles ?? []);
  writeFileSync(appConfigPath, JSON.stringify(isolatedConfig, null, 2));

  let electronApp;
  let page;
  let status = "failed";
  let errorMessage = null;
  let diagnostics = null;
  let screenshotCaptured = false;

  try {
    electronApp = await electron.launch({
      executablePath: appExecutable,
      env: {
        ...process.env,
        HOME: tmpHome,
        LETTA_USER_DATA_PATH: tmpUserData,
      },
      timeout: DEFAULT_RENDER_TIMEOUT_MS,
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await ensureNoGlobalError(page);

    for (const step of normalizeCaseSteps(evalCase)) {
      await executeStep(page, step, { workingDir });
    }

    diagnostics = await collectRendererDiagnostics(page);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    screenshotCaptured = true;
    status = "passed";
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);

    if (page) {
      try {
        diagnostics = await collectRendererDiagnostics(page);
      } catch {
        diagnostics = diagnostics ?? null;
      }
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        screenshotCaptured = true;
      } catch {
        screenshotCaptured = false;
      }
    }
  } finally {
    try {
      await electronApp?.close();
    } catch {
      // ignore shutdown failures
    }
  }

  const report = {
    schemaVersion: 1,
    caseId: evalCase.id,
    surface: evalCase.surface,
    mode: evalCase.mode,
    type: evalCase.type,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    appPath,
    configPath,
    isolatedUserDataPath: tmpUserData,
    isolatedHomePath: tmpHome,
    screenshotPath: screenshotCaptured ? screenshotPath : null,
    workingDir,
    firstMessage,
    diagnostics,
    error: errorMessage,
  };

  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  safeRemove(tmpHome);
  safeRemove(tmpUserData);
  safeRemove(tmpCwd);

  if (status !== "passed") {
    throw new Error(`desktop renderer eval ${evalCase.id} failed: ${errorMessage ?? "unknown error"}`);
  }

  return report;
}
