import { describe, expect, it } from "vitest";
import {
  buildIncidentFingerprint,
  buildIncidentFileName,
  createIncidentPack,
  formatCompactDiagnostics,
  sanitizeConfigSnapshot,
  synthesizeIncidentsFromTraces,
} from "./incident-pack.js";

const sampleSummary = {
  traceId: "trc_demo",
  turnId: "turn_demo",
  sessionId: "conv_demo",
  summary: "Trace failed at RC_DESKTOP_RUN_004 after RC_DESKTOP_RUN_001.",
  errorCode: "E_RESIDENT_CORE_DESKTOP_RUN_FAILED",
  lastSuccessfulDecisionId: "RC_DESKTOP_RUN_001",
  firstFailedDecisionId: "RC_DESKTOP_RUN_004",
  suggestedAction: "Inspect the Resident Core desktop session owner path.",
  createdAt: "2026-04-10T16:45:37.054Z",
  updatedAt: "2026-04-10T16:45:38.917Z",
  stepCount: 2,
  steps: [
    {
      component: "resident-core",
      decisionId: "RC_DESKTOP_RUN_001",
      status: "ok",
      message: "Resident Core desktop session run entered",
    },
    {
      component: "resident-core-session-owner",
      decisionId: "RC_DESKTOP_RUN_004",
      status: "error",
      message: "Resident Core desktop session run failed",
      errorCode: "E_RESIDENT_CORE_DESKTOP_RUN_FAILED",
    },
  ],
};

describe("incident pack helpers", () => {
  it("formats compact diagnostics text", () => {
    const text = formatCompactDiagnostics(sampleSummary);
    expect(text).toContain("Trace ID: trc_demo");
    expect(text).toContain("1. ok | resident-core | RC_DESKTOP_RUN_001");
  });

  it("sanitizes config snapshots without leaking secrets", () => {
    const sanitized = sanitizeConfigSnapshot({
      connectionType: "anthropic-compatible",
      model: "lc-minimax/MiniMax-M2.7",
      LETTA_BASE_URL: "https://api.example.com",
      LETTA_API_KEY: "secret-value",
      residentCore: {
        telegram: {
          botToken: "telegram-secret",
          dmPolicy: "open",
          streaming: true,
          workingDir: "/tmp/work",
        },
      },
    });

    expect(sanitized).toMatchObject({
      connectionType: "anthropic-compatible",
      model: "lc-minimax/MiniMax-M2.7",
      LETTA_BASE_URL: "https://api.example.com",
      residentCore: {
        telegram: {
          configured: true,
          dmPolicy: "open",
          streaming: true,
          workingDir: "/tmp/work",
        },
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain("secret-value");
    expect(JSON.stringify(sanitized)).not.toContain("telegram-secret");
  });

  it("creates an incident pack with environment and trace data", () => {
    const pack = createIncidentPack({
      incident: {
        ...sampleSummary,
        fingerprint: "E_RESIDENT_CORE_DESKTOP_RUN_FAILED::RC_DESKTOP_RUN_004",
        capturedAt: "2026-04-10T16:45:38.917Z",
        lastSeenAt: "2026-04-10T16:45:38.917Z",
        occurrenceCount: 2,
        recentTraceIds: ["trc_demo", "trc_prev"],
      },
      primaryTrace: sampleSummary,
      relatedTraces: [sampleSummary],
      environment: {
        surface: "desktop",
        mode: "packaged",
        connectionType: "anthropic-compatible",
        provider: "anthropic-compatible",
        model: "lc-minimax/MiniMax-M2.7",
        workingDir: "/Users/jachi/Desktop/letta-workspace",
        appVersion: "0.1.3",
        appRepoPath: "/repo/app",
      },
      configSnapshot: {
        connectionType: "anthropic-compatible",
      },
      paths: {
        userDataPath: "/Users/test/Library/Application Support/Letta",
      },
    });

    expect(pack.id).toContain("incident-e-resident-core-desktop-run-failed");
    expect(pack.environment.mode).toBe("packaged");
    expect(pack.diagnostics.traceId).toBe("trc_demo");
    expect(pack.incidentStats.occurrenceCount).toBe(2);
  });

  it("builds stable incident pack file names", () => {
    const fileName = buildIncidentFileName({
      traceId: "trc_demo",
      fingerprint: "E_RESIDENT_CORE_DESKTOP_RUN_FAILED::RC_DESKTOP_RUN_004",
      capturedAt: "2026-04-10T16:45:38.917Z",
    });

    expect(fileName).toMatch(/^2026-04-10-e-resident-core-desktop-run-failed-rc-desktop-run-004-trc-demo\.json$/);
  });

  it("can synthesize incident samples from failed traces", () => {
    const incidents = synthesizeIncidentsFromTraces([
      sampleSummary,
      {
        ...sampleSummary,
        traceId: "trc_demo_2",
        updatedAt: "2026-04-10T16:50:38.917Z",
      },
    ]);

    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      fingerprint: buildIncidentFingerprint(sampleSummary),
      occurrenceCount: 2,
      recentTraceIds: ["trc_demo_2", "trc_demo"],
    });
  });
});
