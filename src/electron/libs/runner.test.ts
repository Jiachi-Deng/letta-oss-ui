import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { E_STREAM_EMPTY_RESULT } from "../../shared/error-codes.js";
import {
  PERMISSION_REQUEST_001,
  STREAM_EMPTY_RESULT_001,
} from "../../shared/decision-ids.js";

const createSessionMock = vi.hoisted(() => vi.fn());
const resumeSessionMock = vi.hoisted(() => vi.fn());
const getAppConfigStateMock = vi.hoisted(() => vi.fn());
const prepareRuntimeConnectionMock = vi.hoisted(() => vi.fn());
const acquireReusableConversationSessionMock = vi.hoisted(() => vi.fn());
const beginReusableConversationTurnMock = vi.hoisted(() => vi.fn());
const completeReusableConversationTurnMock = vi.hoisted(() => vi.fn());
const beginCodeIslandObservationMock = vi.hoisted(() => vi.fn());
const finishCodeIslandObservationMock = vi.hoisted(() => vi.fn());
const mirrorCodeIslandAssistantMessageMock = vi.hoisted(() => vi.fn());
const mirrorCodeIslandToolResultMock = vi.hoisted(() => vi.fn());
const mirrorCodeIslandToolRunningMock = vi.hoisted(() => vi.fn());

vi.mock("@letta-ai/letta-code-sdk", () => ({
  createSession: createSessionMock,
  resumeSession: resumeSessionMock,
}));

vi.mock("./config.js", () => ({
  getAppConfigState: getAppConfigStateMock,
}));

vi.mock("./provider-bootstrap.js", () => ({
  prepareRuntimeConnection: prepareRuntimeConnectionMock,
}));

vi.mock("./conversation-session-cache.js", () => ({
  acquireReusableConversationSession: acquireReusableConversationSessionMock,
  beginReusableConversationTurn: beginReusableConversationTurnMock,
  completeReusableConversationTurn: completeReusableConversationTurnMock,
}));

vi.mock("./codeisland-observer.js", () => ({
  beginCodeIslandObservation: beginCodeIslandObservationMock,
  finishCodeIslandObservation: finishCodeIslandObservationMock,
  mirrorCodeIslandAssistantMessage: mirrorCodeIslandAssistantMessageMock,
  mirrorCodeIslandToolResult: mirrorCodeIslandToolResultMock,
  mirrorCodeIslandToolRunning: mirrorCodeIslandToolRunningMock,
}));

type FakeSession = {
  conversationId: string;
  agentId: string;
  send: (prompt: string) => Promise<void>;
  stream: () => AsyncGenerator<{ type: string; success?: boolean }>;
  close: () => void;
  abort: () => Promise<void>;
};

describe("runLetta", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    acquireReusableConversationSessionMock.mockReturnValue(null);
    getAppConfigStateMock.mockReturnValue({
      config: {
        connectionType: "letta-server",
        LETTA_BASE_URL: "http://localhost:8283",
        model: "gpt-4o",
      },
    });
    prepareRuntimeConnectionMock.mockResolvedValue({
      baseUrl: "http://localhost:8283",
      apiKey: "local-dev-key",
      modelHandle: "gpt-4o",
      cliPath: "/tmp/letta.js",
      bootstrapAction: { kind: "none" },
    });
  });

  afterEach(async () => {
    const { resetDiagnosticsForTests } = await import("./diagnostics.js");
    resetDiagnosticsForTests();
  });

  it("logs permission requests and empty stream results with stable phase 1 ids", async () => {
    let capturedSessionOptions: {
      canUseTool: (toolName: string, input: unknown) => Promise<unknown>;
    } | null = null;

    const fakeSession: FakeSession = {
      conversationId: "conv_runner",
      agentId: "agent_runner",
      send: vi.fn(async () => {
        void capturedSessionOptions?.canUseTool("AskUserQuestion", {
          question: "Approve this tool?",
        });
      }),
      stream: async function* () {
        yield { type: "result", success: true };
      },
      close: vi.fn(),
      abort: vi.fn(async () => undefined),
    };

    createSessionMock.mockImplementation((_agentId, sessionOptions) => {
      capturedSessionOptions = sessionOptions;
      return fakeSession;
    });
    resumeSessionMock.mockImplementation((_conversationId, sessionOptions) => {
      capturedSessionOptions = sessionOptions;
      return fakeSession;
    });

    const { getDiagnosticSummary, listDiagnosticSteps, resetDiagnosticsForTests } = await import("./diagnostics.js");
    const { runLetta } = await import("./runner.ts");
    const onEvent = vi.fn();

    try {
      await runLetta({
        prompt: "Hello",
        session: {
          id: "pending",
          title: "New session",
          status: "running",
          cwd: "/tmp/workspace",
          pendingPermissions: new Map(),
        },
        trace: { traceId: "trc_runner", turnId: "turn_runner" },
        onEvent,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      const summary = getDiagnosticSummary("trc_runner");
      expect(summary).toMatchObject({
        traceId: "trc_runner",
        errorCode: E_STREAM_EMPTY_RESULT,
        firstFailedDecisionId: STREAM_EMPTY_RESULT_001,
      });

      expect(listDiagnosticSteps("trc_runner")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ decisionId: PERMISSION_REQUEST_001 }),
          expect.objectContaining({ decisionId: STREAM_EMPTY_RESULT_001 }),
        ]),
      );

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "permission.request",
          payload: expect.objectContaining({
            toolName: "AskUserQuestion",
          }),
        }),
      );

      expect(capturedSessionOptions).not.toBeNull();
      expect(fakeSession.send).toHaveBeenCalledWith("Hello");
      expect(beginCodeIslandObservationMock).toHaveBeenCalledWith(
        "conv_runner",
        "/tmp/workspace",
        "Hello",
      );
    } finally {
      resetDiagnosticsForTests();
    }
  });
});
