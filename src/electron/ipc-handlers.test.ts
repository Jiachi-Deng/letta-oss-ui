import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());
const runLettaMock = vi.hoisted(() => vi.fn());
const createSessionProjectionMock = vi.hoisted(() => vi.fn());
const updateSessionProjectionMock = vi.hoisted(() => vi.fn());
const getSessionProjectionMock = vi.hoisted(() => vi.fn());
const getSessionProjectionHistoryMock = vi.hoisted(() => vi.fn());
const deleteSessionProjectionMock = vi.hoisted(() => vi.fn());
const listSessionProjectionsMock = vi.hoisted(() => vi.fn());
const rekeySessionProjectionMock = vi.hoisted(() => vi.fn());
const appendSessionProjectionMessageMock = vi.hoisted(() => vi.fn());
const clearAllSessionProjectionsMock = vi.hoisted(() => vi.fn());
const clearCodeIslandObservationMock = vi.hoisted(() => vi.fn());
const finishCodeIslandObservationMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
	app: {
		isPackaged: false,
		getPath: vi.fn(() => "/tmp/letta-desktop-test"),
	},
	BrowserWindow: {
		getAllWindows: () => [
			{
				webContents: {
					send: sendMock,
				},
			},
		],
	},
}));

vi.mock("./libs/runner.js", () => ({
	runLetta: runLettaMock,
}));

vi.mock("./libs/runtime-state.js", () => ({
	createSessionProjection: createSessionProjectionMock,
	updateSessionProjection: updateSessionProjectionMock,
	getSessionProjection: getSessionProjectionMock,
	getSessionProjectionHistory: getSessionProjectionHistoryMock,
	deleteSessionProjection: deleteSessionProjectionMock,
	listSessionProjections: listSessionProjectionsMock,
	rekeySessionProjection: rekeySessionProjectionMock,
	appendSessionProjectionMessage: appendSessionProjectionMessageMock,
	clearAllSessionProjections: clearAllSessionProjectionsMock,
}));

vi.mock("./libs/codeisland-observer.js", () => ({
	clearCodeIslandObservation: clearCodeIslandObservationMock,
	finishCodeIslandObservation: finishCodeIslandObservationMock,
}));

describe("handleClientEvent", () => {
	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		getSessionProjectionMock.mockReturnValue(undefined);
		getSessionProjectionHistoryMock.mockReturnValue([]);

		const { bindResidentCoreService, residentCoreBroadcast } = await import("./ipc-handlers.ts");
		const { ResidentCoreService } = await import("./libs/resident-core/resident-core.ts");
		const mockSessionOwner = {
			runDesktopSession: vi.fn(),
			warmDesktopSession: vi.fn(),
			invalidateDesktopSession: vi.fn(),
			runBotSession: vi.fn(),
			warmBotSession: vi.fn(),
			invalidateBotSession: vi.fn(),
		};

		bindResidentCoreService(
			new ResidentCoreService(residentCoreBroadcast, mockSessionOwner as never),
		);
	});

	it("broadcasts runner.error when session start fails", async () => {
		runLettaMock.mockRejectedValueOnce(new Error("compatible bootstrap failed"));

		const { handleClientEvent } = await import("./ipc-handlers.ts");

		await handleClientEvent({
			type: "session.start",
			payload: {
				title: "",
				prompt: "Start a session",
				cwd: "/tmp/workspace",
			},
		});

		expect(runLettaMock).toHaveBeenCalledTimes(1);
		expect(createSessionProjectionMock).not.toHaveBeenCalled();
		expect(sendMock).toHaveBeenCalledTimes(1);
		expect(sendMock).toHaveBeenCalledWith(
			"server-event",
			expect.any(String),
		);

		const payload = JSON.parse(sendMock.mock.calls[0][1] as string);
		expect(payload).toMatchObject({
			type: "runner.error",
			payload: {
				message: "Error: compatible bootstrap failed",
			},
		});
	});

	it("logs and surfaces a stable history load failure", async () => {
		getSessionProjectionMock.mockReturnValue({
			conversationId: "conv-history",
			title: "History session",
			status: "running",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			pendingPermissions: new Map(),
			messages: [],
		});
		getSessionProjectionHistoryMock.mockImplementation(() => {
			throw new Error("history unavailable");
		});

		const { handleClientEvent } = await import("./ipc-handlers.ts");
		const { getDiagnosticSummary, resetDiagnosticsForTests } = await import("./libs/diagnostics.ts");

		try {
			await handleClientEvent({
				type: "session.history",
				payload: {
					sessionId: "conv-history",
				},
			});

			expect(sendMock).toHaveBeenCalledTimes(1);
			const payload = JSON.parse(sendMock.mock.calls[0][1] as string);
			expect(payload).toMatchObject({
				type: "runner.error",
				payload: {
					sessionId: "conv-history",
					message: "Error: history unavailable",
				},
			});

			expect(getDiagnosticSummary(payload.payload.traceId)).toMatchObject({
				sessionId: "conv-history",
				firstFailedDecisionId: "SESSION_HISTORY_003",
				errorCode: "E_HISTORY_LOAD_FAILED",
			});
		} finally {
			resetDiagnosticsForTests();
		}
	});

	it("surfaces a stable permission response missing failure", async () => {
		getSessionProjectionMock.mockReturnValue({
			conversationId: "conv-permission",
			title: "Permission session",
			status: "running",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			pendingPermissions: new Map(),
			messages: [],
		});

		const { handleClientEvent } = await import("./ipc-handlers.ts");
		const { getDiagnosticSummary, resetDiagnosticsForTests } = await import("./libs/diagnostics.ts");

		try {
			await handleClientEvent({
				type: "permission.response",
				payload: {
					sessionId: "conv-permission",
					toolUseId: "tool-missing",
					result: { behavior: "allow" },
				},
			});

			expect(sendMock).toHaveBeenCalledTimes(1);
			const payload = JSON.parse(sendMock.mock.calls[0][1] as string);
			expect(payload).toMatchObject({
				type: "runner.error",
				payload: {
					sessionId: "conv-permission",
					message: "Permission response did not match an active pending request.",
				},
			});

			expect(getDiagnosticSummary(payload.payload.traceId)).toMatchObject({
				sessionId: "conv-permission",
				firstFailedDecisionId: "PERMISSION_RESPONSE_003",
				errorCode: "E_PERMISSION_RESPONSE_MISSING",
			});
		} finally {
			resetDiagnosticsForTests();
		}
	});
});
