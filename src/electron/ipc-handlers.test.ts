import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());
const runLettaMock = vi.hoisted(() => vi.fn());
const createSessionProjectionMock = vi.hoisted(() => vi.fn());
const updateSessionProjectionMock = vi.hoisted(() => vi.fn());
const getSessionProjectionMock = vi.hoisted(() => vi.fn());
const deleteSessionProjectionMock = vi.hoisted(() => vi.fn());
const clearCodeIslandObservationMock = vi.hoisted(() => vi.fn());
const finishCodeIslandObservationMock = vi.hoisted(() => vi.fn());

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
	createSessionProjection: createSessionProjectionMock,
	updateSessionProjection: updateSessionProjectionMock,
	getSessionProjection: getSessionProjectionMock,
	deleteSessionProjection: deleteSessionProjectionMock,
}));

vi.mock("./libs/codeisland-observer.js", () => ({
	clearCodeIslandObservation: clearCodeIslandObservationMock,
	finishCodeIslandObservation: finishCodeIslandObservationMock,
}));

describe("handleClientEvent", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		getSessionProjectionMock.mockReturnValue(undefined);
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
});
