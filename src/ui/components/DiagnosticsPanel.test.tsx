// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

type TraceListItem = {
  traceId: string;
  turnId?: string;
  sessionId?: string;
  summary: string;
  errorCode?: string;
  lastSuccessfulDecisionId?: string;
  firstFailedDecisionId?: string;
  suggestedAction?: string;
  createdAt?: string;
  updatedAt?: string;
  stepCount?: number;
};

function createSummary(traceId: string, overrides: Partial<TraceListItem> = {}): TraceListItem {
  return {
    traceId,
    sessionId: `conv_${traceId}`,
    turnId: `turn_${traceId}`,
    summary: `Summary for ${traceId}`,
    errorCode: undefined,
    lastSuccessfulDecisionId: "RUNNER_INIT_001",
    firstFailedDecisionId: undefined,
    suggestedAction: "Inspect diagnostics.",
    createdAt: "2026-04-09T18:00:00.000Z",
    updatedAt: "2026-04-09T18:01:00.000Z",
    stepCount: 2,
    ...overrides,
  };
}

describe("DiagnosticsPanel", () => {
  const listDiagnosticSummariesMock = vi.fn();
  const getDiagnosticSummaryMock = vi.fn();
  const clipboardWriteMock = vi.fn(async (text: string) => {
    clipboardBuffer = text;
  });
  const clipboardReadMock = vi.fn(async () => clipboardBuffer);
  let clipboardBuffer = "";

  beforeEach(() => {
    vi.clearAllMocks();
    clipboardBuffer = "";
    listDiagnosticSummariesMock.mockResolvedValue([]);
    getDiagnosticSummaryMock.mockResolvedValue(null);

    Object.defineProperty(window, "electron", {
      value: {
        listDiagnosticSummaries: listDiagnosticSummariesMock,
        getDiagnosticSummary: getDiagnosticSummaryMock,
      },
      configurable: true,
    });

    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: clipboardWriteMock,
        readText: clipboardReadMock,
      },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("filters traces by errorCode", async () => {
    const user = userEvent.setup();
    listDiagnosticSummariesMock.mockResolvedValue([
      createSummary("trc_alpha", {
        sessionId: "conv_alpha",
        errorCode: "E_PROVIDER_CONNECT_FAILED",
        summary: "Trace failed at BOOT_CONN_002 after RUNNER_INIT_001.",
        stepCount: 2,
      }),
      createSummary("trc_beta", {
        sessionId: "conv_beta",
        errorCode: "E_CODEISLAND_LAUNCH_BLOCKED",
        summary: "Trace failed at CI_BOOT_004 after CI_BOOT_003.",
        stepCount: 2,
      }),
    ]);
    getDiagnosticSummaryMock.mockImplementation(async (traceId: string) => {
      if (traceId === "trc_alpha") {
        return {
          ...createSummary("trc_alpha", {
            sessionId: "conv_alpha",
            errorCode: "E_PROVIDER_CONNECT_FAILED",
            summary: "Trace failed at BOOT_CONN_002 after RUNNER_INIT_001.",
          }),
          steps: [
            {
              component: "runner",
              decisionId: "RUNNER_INIT_001",
              status: "ok",
              message: "runtime connection ready",
            },
            {
              component: "provider-bootstrap",
              decisionId: "BOOT_CONN_002",
              status: "error",
              message: "runtime connection bootstrap failed during compatible provider registration",
              errorCode: "E_PROVIDER_CONNECT_FAILED",
            },
          ],
        };
      }

      return {
        ...createSummary("trc_beta", {
          sessionId: "conv_beta",
          errorCode: "E_CODEISLAND_LAUNCH_BLOCKED",
          summary: "Trace failed at CI_BOOT_004 after CI_BOOT_003.",
        }),
        steps: [
          {
            component: "bundled-codeisland",
            decisionId: "CI_BOOT_003",
            status: "ok",
            message: "Launching CodeIsland via open command",
          },
          {
            component: "bundled-codeisland",
            decisionId: "CI_BOOT_004",
            status: "error",
            message: "CodeIsland failed launch verification",
            errorCode: "E_CODEISLAND_LAUNCH_BLOCKED",
          },
        ],
      };
    });

    render(<DiagnosticsPanel onBackToChat={vi.fn()} />);

    await screen.findByText("Trace failed at BOOT_CONN_002 after RUNNER_INIT_001.");
    expect(screen.getByTestId("diagnostics-trace-card-trc_alpha")).toBeInTheDocument();
    expect(screen.getByTestId("diagnostics-trace-card-trc_beta")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Error code"), "E_PROVIDER_CONNECT_FAILED");

    expect(screen.getByTestId("diagnostics-trace-card-trc_alpha")).toBeInTheDocument();
    expect(screen.queryByTestId("diagnostics-trace-card-trc_beta")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trace failed at BOOT_CONN_002 after RUNNER_INIT_001." })).toBeInTheDocument();
  });

  it("searches traces by traceId and sessionId", async () => {
    const user = userEvent.setup();
    listDiagnosticSummariesMock.mockResolvedValue([
      createSummary("trc_alpha", { sessionId: "conv_alpha", summary: "Alpha trace" }),
      createSummary("trc_beta", { sessionId: "conv_beta", summary: "Beta trace" }),
    ]);
    getDiagnosticSummaryMock.mockResolvedValue({
      ...createSummary("trc_alpha", { sessionId: "conv_alpha", summary: "Alpha trace" }),
      steps: [],
    });

    render(<DiagnosticsPanel onBackToChat={vi.fn()} />);

    await screen.findByText("Alpha trace");
    const searchInput = screen.getByLabelText("Search traces");

    await user.type(searchInput, "trc_beta");
    expect(screen.queryByTestId("diagnostics-trace-card-trc_alpha")).not.toBeInTheDocument();
    expect(screen.getByTestId("diagnostics-trace-card-trc_beta")).toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, "conv_alpha");
    expect(screen.getByTestId("diagnostics-trace-card-trc_alpha")).toBeInTheDocument();
    expect(screen.queryByTestId("diagnostics-trace-card-trc_beta")).not.toBeInTheDocument();
  });

  it("copies the full trace with metadata and step data", async () => {
    const user = userEvent.setup();
    listDiagnosticSummariesMock.mockResolvedValue([
      createSummary("trc_full", {
        sessionId: "conv_full",
        errorCode: "E_LETTA_CLI_EXIT_NON_ZERO",
        summary: "Trace failed at CLI_CONNECT_005 after CLI_CONNECT_003.",
        lastSuccessfulDecisionId: "CLI_CONNECT_003",
        firstFailedDecisionId: "CLI_CONNECT_005",
        stepCount: 2,
      }),
    ]);
    getDiagnosticSummaryMock.mockResolvedValue({
      traceId: "trc_full",
      turnId: "turn_full",
      sessionId: "conv_full",
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
          status: "ok",
          message: "letta-code CLI stderr observed",
          data: {
            preview: "provider warning",
          },
        },
        {
          component: "letta-code-cli",
          decisionId: "CLI_CONNECT_005",
          status: "error",
          message: "letta-code CLI exited non-zero",
          errorCode: "E_LETTA_CLI_EXIT_NON_ZERO",
          data: {
            exitCode: 1,
            stderrPreview: "provider warning",
          },
        },
      ],
    });

    render(<DiagnosticsPanel onBackToChat={vi.fn()} />);

    await screen.findByText("Trace failed at CLI_CONNECT_005 after CLI_CONNECT_003.");
    await waitFor(() => expect(getDiagnosticSummaryMock).toHaveBeenCalledWith("trc_full"));
    const copyFullTraceButton = await screen.findByRole("button", { name: "Copy full trace" });
    await user.click(copyFullTraceButton);

    await waitFor(async () => {
      await expect(navigator.clipboard.readText()).resolves.toContain("Trace ID: trc_full");
    });
    await expect(navigator.clipboard.readText()).resolves.toContain("Data: {");
    await expect(navigator.clipboard.readText()).resolves.toContain("\"exitCode\": 1");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
