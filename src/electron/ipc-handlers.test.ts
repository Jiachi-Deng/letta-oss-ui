import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());
const runLettaMock = vi.hoisted(() => vi.fn());
const createRuntimeSessionMock = vi.hoisted(() => vi.fn());
const updateSessionMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const deleteSessionMock = vi.hoisted(() => vi.fn());
const clearCodeIslandSessionMock = vi.hoisted(() => vi.fn());
const notifyCodeIslandStopMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
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
	createRuntimeSession: createRuntimeSessionMock,
	updateSession: updateSessionMock,
	getSession: getSessionMock,
	deleteSession: deleteSessionMock,
}));

vi.mock("./libs/codeisland.js", () => ({
	clearCodeIslandSession: clearCodeIslandSessionMock,
	notifyCodeIslandStop: notifyCodeIslandStopMock,
}));

describe("handleClientEvent", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		getSessionMock.mockReturnValue(undefined);
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
		expect(createRuntimeSessionMock).not.toHaveBeenCalled();
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
});
