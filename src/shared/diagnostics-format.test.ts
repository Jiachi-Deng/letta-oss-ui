import { describe, expect, it } from "vitest";
import {
  formatDiagnosticSummary,
  formatFullDiagnosticTrace,
} from "./diagnostics-format";

describe("diagnostics formatters", () => {
  const summary = {
    traceId: "trc_123",
    turnId: "turn_123",
    sessionId: "conv_123",
    summary: "Trace failed at CLI_CONNECT_005 after CLI_CONNECT_003.",
    errorCode: "E_LETTA_CLI_EXIT_NON_ZERO",
    lastSuccessfulDecisionId: "CLI_CONNECT_003",
    firstFailedDecisionId: "CLI_CONNECT_005",
    suggestedAction: "Inspect the letta connect CLI stderr/stdout summary and confirm the provider arguments were accepted.",
    createdAt: "2026-04-09T18:00:00.000Z",
    updatedAt: "2026-04-09T18:01:00.000Z",
    stepCount: 2,
    steps: [
      {
        component: "letta-code-cli",
        decisionId: "CLI_CONNECT_003",
        status: "ok" as const,
        message: "letta-code CLI stderr observed",
        data: { preview: "provider warning" },
      },
      {
        component: "letta-code-cli",
        decisionId: "CLI_CONNECT_005",
        status: "error" as const,
        message: "letta-code CLI exited non-zero",
        errorCode: "E_LETTA_CLI_EXIT_NON_ZERO",
        data: { exitCode: 1, stderrPreview: "provider warning" },
      },
    ],
  };

  it("formats the compact diagnostics payload", () => {
    const output = formatDiagnosticSummary(summary);

    expect(output).toContain("Summary: Trace failed at CLI_CONNECT_005 after CLI_CONNECT_003.");
    expect(output).toContain("Steps:");
    expect(output).not.toContain("provider warning");
  });

  it("formats the full trace with metadata and step data", () => {
    const output = formatFullDiagnosticTrace(summary);

    expect(output).toContain("Trace ID: trc_123");
    expect(output).toContain("Session ID: conv_123");
    expect(output).toContain("Data: {");
    expect(output).toContain("\"exitCode\": 1");
    expect(output).toContain("E_LETTA_CLI_EXIT_NON_ZERO");
  });
});
