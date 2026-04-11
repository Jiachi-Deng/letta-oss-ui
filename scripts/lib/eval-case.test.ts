import { describe, expect, it } from "vitest";
import { buildEvalCaseFilePath, createEvalCaseFromIncidentPack } from "./eval-case.js";

const sampleIncidentPack = {
  id: "incident-e-resident-core-desktop-run-failed",
  surface: "desktop",
  mode: "packaged",
  title: "desktop incident at RC_DESKTOP_RUN_004 (E_RESIDENT_CORE_DESKTOP_RUN_FAILED)",
  fingerprint: "E_RESIDENT_CORE_DESKTOP_RUN_FAILED::RC_DESKTOP_RUN_004",
  diagnostics: {
    traceId: "trc_demo",
    errorCode: "E_RESIDENT_CORE_DESKTOP_RUN_FAILED",
    lastSuccessfulDecisionId: "RC_DESKTOP_RUN_001",
    firstFailedDecisionId: "RC_DESKTOP_RUN_004",
    suggestedAction: "Inspect the Resident Core desktop session owner path.",
  },
  environment: {
    surface: "desktop",
    mode: "packaged",
    connectionType: "anthropic-compatible",
    provider: "anthropic-compatible",
    model: "lc-minimax/MiniMax-M2.7",
    workingDir: "/Users/jachi/Desktop/letta-workspace",
  },
};

describe("eval case generator", () => {
  it("creates a packaged desktop eval case from an incident pack", () => {
    const evalCase = createEvalCaseFromIncidentPack(sampleIncidentPack);

    expect(evalCase).toMatchObject({
      surface: "desktop",
      type: "packaged",
      mode: "packaged",
      setup: {
        resetUserState: true,
        configPreset: "compatible-minimax",
      },
    });
    expect(evalCase.steps).toEqual([
      { action: "install_app_to_applications" },
      { action: "launch_app_from_finder" },
      { action: "complete_onboarding_if_needed" },
      { action: "send_message", value: "你好" },
    ]);
    expect(evalCase.expect.diagnostics.mustNotHaveErrorCodes).toContain("E_RESIDENT_CORE_DESKTOP_RUN_FAILED");
  });

  it("creates a telegram flow case with burst follow-up for telegram fingerprints", () => {
    const evalCase = createEvalCaseFromIncidentPack({
      ...sampleIncidentPack,
      surface: "telegram",
      mode: "runtime",
      fingerprint: "E_LETTABOT_MESSAGE_PROCESS_FAILED::LETTABOT_FOREGROUND_003::TG_RUNTIME_001",
      diagnostics: {
        ...sampleIncidentPack.diagnostics,
        errorCode: "E_LETTABOT_MESSAGE_PROCESS_FAILED",
        firstFailedDecisionId: "LETTABOT_FOREGROUND_003",
      },
    });

    expect(evalCase.type).toBe("flow");
    expect(evalCase.steps[0]).toEqual({ action: "ensure_telegram_host_ready" });
    expect(evalCase.steps[2]).toMatchObject({ action: "send_telegram_burst" });
    expect(evalCase.expect.channel).toMatchObject({ mustReply: true });
  });

  it("builds eval case output paths under the surface directory", () => {
    const evalCase = createEvalCaseFromIncidentPack(sampleIncidentPack);
    const filePath = buildEvalCaseFilePath({
      evalCase,
      incidentPackPath: "/tmp/2026-04-10-incident.json",
      casesRoot: "/tmp/evals/cases",
    });

    expect(filePath).toBe("/tmp/evals/cases/desktop/2026-04-10-incident.case.json");
  });
});
