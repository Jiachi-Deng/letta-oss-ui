import { beforeEach, describe, expect, it, vi } from "vitest";

const runLettaMock = vi.hoisted(() => vi.fn());
const sessionOwnerMock = {} as never;

vi.mock("electron", () => ({
	app: {
		isPackaged: false,
		getPath: vi.fn(() => "/tmp/letta-desktop-test"),
	},
}));

vi.mock("../runner.js", () => ({
	runLetta: runLettaMock,
}));

describe("ResidentCoreService", () => {
	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		const { clearAllSessionProjections } = await import("../runtime-state.js");
		clearAllSessionProjections();
	});

	it("emits the current session list from the shared projection store", async () => {
		const { createSessionProjection } = await import("../runtime-state.js");
		createSessionProjection("conv-core-list", {
			title: "Core list session",
			status: "running",
			cwd: "/tmp/workspace",
		});

		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock);

		await service.handleClientEvent({ type: "session.list" });

		expect(broadcast).toHaveBeenCalledWith({
			type: "session.list",
			payload: {
				sessions: expect.arrayContaining([
					expect.objectContaining({
						id: "conv-core-list",
						title: "Core list session",
						status: "running",
					}),
				]),
			},
		});
	});

	it("routes session.start and keeps streamed session ids attached to the core projection", async () => {
		const abortMock = vi.fn(async () => undefined);
		runLettaMock.mockImplementation(async (options) => {
			options.onSessionUpdate?.({ lettaConversationId: "conv-core-start" });
			options.onEvent?.({
				type: "stream.message",
				payload: {
					sessionId: "pending",
					message: {
						type: "assistant",
						uuid: "msg-core-1",
						content: "hello",
					},
				},
			});
			return { abort: abortMock };
		});

		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const { getSessionProjection, getSessionProjectionHistory } = await import("../runtime-state.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock);

		await service.handleClientEvent({
			type: "session.start",
			payload: {
				title: "Core start",
				prompt: "Hello from core",
				cwd: "/tmp/workspace",
			},
		});

		expect(runLettaMock).toHaveBeenCalledTimes(1);
		expect(runLettaMock.mock.calls[0][0].runtime).toEqual(
			expect.objectContaining({
				sessionOwner: expect.any(Object),
			}),
		);

		expect(getSessionProjection("conv-core-start")).toMatchObject({
			conversationId: "conv-core-start",
			title: "conv-core-start",
			status: "running",
		});
		expect(getSessionProjectionHistory("conv-core-start")).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "user_prompt",
					prompt: "Hello from core",
				}),
				expect.objectContaining({
					type: "assistant",
					uuid: "msg-core-1",
				}),
			]),
		);

		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "session.status",
				payload: expect.objectContaining({
					sessionId: "conv-core-start",
					status: "running",
				}),
			}),
		);
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "stream.user_prompt",
				payload: expect.objectContaining({
					sessionId: "conv-core-start",
					prompt: "Hello from core",
				}),
			}),
		);
	});

	it("routes session.continue through the core and rekeys projections when the runtime assigns a new conversation id", async () => {
		const { createSessionProjection } = await import("../runtime-state.js");
		createSessionProjection("conv-old", {
			title: "Old session",
			status: "idle",
			pendingPermissions: new Map(),
		});

		runLettaMock.mockImplementation(async (options) => {
			options.onSessionUpdate?.({ lettaConversationId: "conv-new" });
			options.onEvent?.({
				type: "stream.message",
				payload: {
					sessionId: "conv-old",
					message: {
						type: "assistant",
						uuid: "msg-continue-1",
						content: "continued",
					},
				},
			});
			return { abort: vi.fn(async () => undefined) };
		});

		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const { getSessionProjection, getSessionProjectionHistory } = await import("../runtime-state.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock);

		await service.handleClientEvent({
			type: "session.continue",
			payload: {
				sessionId: "conv-old",
				prompt: "Continue",
				cwd: "/tmp/workspace",
			},
		});

		expect(getSessionProjection("conv-old")).toBeUndefined();
		expect(getSessionProjection("conv-new")).toMatchObject({
			conversationId: "conv-new",
			title: "conv-new",
			status: "running",
		});
		expect(getSessionProjectionHistory("conv-new")).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "user_prompt",
					prompt: "Continue",
				}),
				expect.objectContaining({
					type: "assistant",
					uuid: "msg-continue-1",
				}),
			]),
		);
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "session.deleted",
				payload: { sessionId: "conv-old" },
			}),
		);
	});

	it("routes session.stop and returns the session to idle after aborting the active handle", async () => {
		const abortMock = vi.fn(async () => undefined);
		runLettaMock.mockImplementation(async (options) => {
			options.onSessionUpdate?.({ lettaConversationId: "conv-core-stop" });
			return { abort: abortMock };
		});

		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const { getSessionProjection } = await import("../runtime-state.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock);

		await service.handleClientEvent({
			type: "session.start",
			payload: {
				title: "Stop session",
				prompt: "Start",
				cwd: "/tmp/workspace",
			},
		});

		await service.handleClientEvent({
			type: "session.stop",
			payload: {
				sessionId: "conv-core-stop",
			},
		});

		expect(abortMock).toHaveBeenCalledTimes(1);
		expect(getSessionProjection("conv-core-stop")).toMatchObject({
			conversationId: "conv-core-stop",
			status: "idle",
		});
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "session.status",
				payload: expect.objectContaining({
					sessionId: "conv-core-stop",
					status: "idle",
				}),
			}),
		);
	});

	it("routes session.delete and clears the resident projection", async () => {
		const abortMock = vi.fn(async () => undefined);
		runLettaMock.mockImplementation(async (options) => {
			options.onSessionUpdate?.({ lettaConversationId: "conv-core-delete" });
			return { abort: abortMock };
		});

		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const { getSessionProjection } = await import("../runtime-state.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock);

		await service.handleClientEvent({
			type: "session.start",
			payload: {
				title: "Delete session",
				prompt: "Start",
				cwd: "/tmp/workspace",
			},
		});

		await service.handleClientEvent({
			type: "session.delete",
			payload: {
				sessionId: "conv-core-delete",
			},
		});

		expect(abortMock).toHaveBeenCalledTimes(1);
		expect(getSessionProjection("conv-core-delete")).toBeUndefined();
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "session.deleted",
				payload: { sessionId: "conv-core-delete" },
			}),
		);
	});

	it("applies permission responses to the pending request on the resident session", async () => {
		const resolveMock = vi.fn();
		const { createSessionProjection } = await import("../runtime-state.js");
		createSessionProjection("conv-permission", {
			title: "Permission session",
			status: "running",
			pendingPermissions: new Map([
				[
					"tool-1",
					{
						toolUseId: "tool-1",
						toolName: "AskUserQuestion",
						input: { question: "Allow?" },
						resolve: resolveMock,
					},
				],
			]),
		});

		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock);

		await service.handleClientEvent({
			type: "permission.response",
			payload: {
				sessionId: "conv-permission",
				toolUseId: "tool-1",
				result: { behavior: "allow" },
			},
		});

		expect(resolveMock).toHaveBeenCalledWith({ behavior: "allow" });
		expect(broadcast).not.toHaveBeenCalledWith(
			expect.objectContaining({
				type: "runner.error",
			}),
		);
	});
});
