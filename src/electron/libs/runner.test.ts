import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { E_STREAM_EMPTY_RESULT } from "../../shared/error-codes.js";
import {
  PERMISSION_REQUEST_001,
  STREAM_EMPTY_RESULT_001,
} from "../../shared/decision-ids.js";

const beginCodeIslandObservationMock = vi.hoisted(() => vi.fn());
const finishCodeIslandObservationMock = vi.hoisted(() => vi.fn());
const mirrorCodeIslandAssistantMessageMock = vi.hoisted(() => vi.fn());
const mirrorCodeIslandToolResultMock = vi.hoisted(() => vi.fn());
const mirrorCodeIslandToolRunningMock = vi.hoisted(() => vi.fn());
const sessionOwnerMock = vi.hoisted(() => ({
  runDesktopSession: vi.fn(),
}));

vi.mock("./resident-core/session-owner.js", () => ({
  createResidentCoreSessionOwner: vi.fn(() => sessionOwnerMock),
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
    sessionOwnerMock.runDesktopSession.mockReset();
  });

  afterEach(async () => {
    const { resetDiagnosticsForTests } = await import("./diagnostics.js");
    resetDiagnosticsForTests();
  });

  it("logs permission requests and empty stream results with stable phase 1 ids", async () => {
    const fakeSession: FakeSession = {
      conversationId: "conv_runner",
      agentId: "agent_runner",
      send: vi.fn(async () => undefined),
      stream: async function* () {
        yield { type: "result", success: true };
      },
      close: vi.fn(),
      abort: vi.fn(async () => undefined),
    };

    sessionOwnerMock.runDesktopSession.mockImplementation(async (options) => {
      void options.canUseTool?.("AskUserQuestion", {
        question: "Approve this tool?",
      });
      return {
        session: fakeSession,
        stream: fakeSession.stream,
      };
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
        runtime: {
          sessionOwner: sessionOwnerMock,
        },
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

      expect(sessionOwnerMock.runDesktopSession).toHaveBeenCalledTimes(1);
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
