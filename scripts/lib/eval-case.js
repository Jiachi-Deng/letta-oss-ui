import path from "node:path";
import { slugifyIncidentPart } from "./incident-pack.js";

function inferConfigPreset(environment) {
  const model = String(environment?.model ?? "").toLowerCase();
  const connectionType = String(environment?.connectionType ?? "").toLowerCase();

  if (model.includes("minimax")) return "compatible-minimax";
  if (connectionType.includes("anthropic")) return "compatible-anthropic";
  if (connectionType.includes("openai")) return "compatible-openai";
  if (connectionType === "letta-server") return "letta-server";
  return "unknown";
}

function inferCaseType(pack) {
  if (pack.mode === "packaged") return "packaged";
  if (pack.surface === "codeisland") return "visual";
  return "flow";
}

function inferPrimaryMessage(pack) {
  if (pack.surface === "telegram") {
    return "你好，回复我一句 hi";
  }
  return "你好";
}

function buildDesktopSteps(pack) {
  const message = inferPrimaryMessage(pack);
  const steps = [
    { action: "launch_app" },
    { action: "complete_onboarding_if_needed" },
    { action: "send_message", value: message },
  ];

  if (pack.mode === "packaged") {
    steps.unshift({ action: "install_app_to_applications" });
  }

  return steps;
}

function buildTelegramSteps(pack) {
  const message = inferPrimaryMessage(pack);
  const steps = [
    { action: "ensure_telegram_host_ready" },
    { action: "send_telegram_message", value: message },
  ];

  const fingerprint = String(pack.fingerprint ?? "");
  if (fingerprint.includes("LETTABOT") || fingerprint.includes("TELEGRAM")) {
    steps.push({
      action: "send_telegram_burst",
      values: [message, "再来一句", "继续", "在吗"],
    });
  }

  return steps;
}

function buildCodeIslandSteps() {
  return [
    { action: "launch_app" },
    { action: "wait_for_codeisland_launch" },
  ];
}

function buildPackagedSteps(pack) {
  const steps = [
    { action: "install_app_to_applications" },
    { action: "launch_app_from_finder" },
  ];

  const fingerprint = String(pack.fingerprint ?? "");
  if (fingerprint.includes("sharp") || fingerprint.includes("libvips")) {
    steps.push({ action: "verify_bundle_resource", value: "sharp/libvips" });
    return steps;
  }

  steps.push({ action: "complete_onboarding_if_needed" });
  steps.push({ action: "send_message", value: inferPrimaryMessage(pack) });
  return steps;
}

function buildSteps(pack) {
  if (pack.surface === "telegram") return buildTelegramSteps(pack);
  if (pack.surface === "codeisland") return buildCodeIslandSteps(pack);
  if (pack.mode === "packaged") return buildPackagedSteps(pack);
  return buildDesktopSteps(pack);
}

function buildExpect(pack) {
  const expectBlock = {
    diagnostics: {},
  };

  if (pack.diagnostics?.errorCode) {
    expectBlock.diagnostics.mustNotHaveErrorCodes = [pack.diagnostics.errorCode];
  }
  if (pack.diagnostics?.firstFailedDecisionId) {
    expectBlock.diagnostics.mustNotHaveFirstFailedDecisionIds = [pack.diagnostics.firstFailedDecisionId];
  }

  if (pack.surface === "telegram") {
    expectBlock.channel = {
      mustReply: true,
    };
  } else if (pack.surface === "codeisland") {
    expectBlock.visual = {
      mustLaunchCodeIsland: true,
    };
  } else {
    expectBlock.ui = {
      mustContainText: [inferPrimaryMessage(pack)],
    };
  }

  return expectBlock;
}

export function createEvalCaseFromIncidentPack(pack) {
  const caseType = inferCaseType(pack);
  const surface = pack.surface ?? "desktop";
  const baseIdParts = [
    surface,
    caseType,
    slugifyIncidentPart(pack.fingerprint ?? pack.diagnostics?.errorCode ?? pack.id),
  ].filter(Boolean);

  return {
    schemaVersion: 1,
    id: baseIdParts.join("-"),
    surface,
    type: caseType,
    mode: pack.mode ?? "unknown",
    title: pack.title ?? `${surface} eval case`,
    source: {
      type: "incident-pack",
      incidentPackId: pack.id,
      fingerprint: pack.fingerprint,
      traceId: pack.diagnostics?.traceId ?? null,
      incidentPackPath: null,
    },
    setup: {
      resetUserState: pack.mode === "packaged",
      configPreset: inferConfigPreset(pack.environment),
      workingDir: pack.environment?.workingDir ?? null,
      surface,
      mode: pack.mode ?? "unknown",
    },
    steps: buildSteps(pack),
    expect: buildExpect(pack),
    notes: {
      generatedFrom: "incident-pack",
      suggestedAction: pack.diagnostics?.suggestedAction ?? null,
      lastSuccessfulDecisionId: pack.diagnostics?.lastSuccessfulDecisionId ?? null,
      firstFailedDecisionId: pack.diagnostics?.firstFailedDecisionId ?? null,
    },
  };
}

export function buildEvalCaseFilePath({ evalCase, incidentPackPath, casesRoot }) {
  const surfaceDir = path.join(casesRoot, evalCase.surface ?? "desktop");
  const sourceName = incidentPackPath
    ? path.basename(incidentPackPath, path.extname(incidentPackPath))
    : evalCase.id;
  return path.join(surfaceDir, `${sourceName}.case.json`);
}
