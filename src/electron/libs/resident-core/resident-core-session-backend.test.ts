import { beforeEach, describe, expect, it, vi } from "vitest";

const createSessionMock = vi.hoisted(() => vi.fn());
const resumeSessionMock = vi.hoisted(() => vi.fn());
const ownerMock = vi.hoisted(() => ({
	warmBotSession: vi.fn(async () => undefined),
	invalidateBotSession: vi.fn(),
	getBotSession: vi.fn(),
	ensureBotSessionForKey: vi.fn(async () => ({ conversationId: "conv-owner" })),
	runBotSession: vi.fn(async () => ({
		session: { conversationId: "conv-owner" },
		stream: async function* () {},
	})),
}));
const serverEventSinkMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
	app: {
		isPackaged: false,
		getPath: vi.fn(() => "/tmp/letta-desktop-test"),
	},
}));

vi.mock("@letta-ai/letta-code-sdk", () => ({
	createSession: createSessionMock,
	resumeSession: resumeSessionMock,
}));

describe("ResidentCoreSessionBackend", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("delegates lifecycle calls to the Resident Core owner instead of constructing sessions directly", async () => {
		const { createResidentCoreSessionBackend } = await import("./resident-core-session-backend.js");

		const backend = createResidentCoreSessionBackend({
			owner: ownerMock as never,
			config: {
				workingDir: "/tmp/workspace",
				allowedTools: [],
				conversationMode: "shared",
				reuseSession: true,
				agentName: "ResidentCoreLettaBot",
			},
		});

		await backend.warmSession();
		await backend.ensureSessionForKey("conv-test");
		await backend.runSession("hello");
		backend.invalidateSession("conv-test");

		expect(ownerMock.warmBotSession).toHaveBeenCalledTimes(1);
		expect(ownerMock.ensureBotSessionForKey).toHaveBeenCalledTimes(1);
		expect(ownerMock.runBotSession).toHaveBeenCalledTimes(1);
		expect(ownerMock.invalidateBotSession).toHaveBeenCalledWith("conv-test", undefined);
		expect(createSessionMock).not.toHaveBeenCalled();
		expect(resumeSessionMock).not.toHaveBeenCalled();
	});

	it("passes runtime generation through bot session invalidation", async () => {
		const { createResidentCoreSessionBackend } = await import("./resident-core-session-backend.js");

		const backend = createResidentCoreSessionBackend({
			owner: ownerMock as never,
			runtimeGeneration: 7,
			config: {
				workingDir: "/tmp/workspace",
				allowedTools: [],
				conversationMode: "shared",
				reuseSession: true,
				agentName: "ResidentCoreLettaBot",
			},
		});

		backend.invalidateSession("conv-guarded");

		expect(ownerMock.invalidateBotSession).toHaveBeenCalledWith("conv-guarded", 7);
	});

	it("emits shared projection events for bot runs while preserving owner delegation", async () => {
		const { createResidentCoreSessionBackend } = await import("./resident-core-session-backend.js");
		ownerMock.runBotSession.mockResolvedValueOnce({
			session: { conversationId: "conv-bot-live" },
			stream: async function* () {
				yield { type: "assistant", content: [{ type: "text", text: "Hello from bot" }] };
				yield { type: "result", success: true };
			},
		});

		const backend = createResidentCoreSessionBackend({
			owner: ownerMock as never,
			onServerEvent: serverEventSinkMock,
			config: {
				workingDir: "/tmp/workspace",
				allowedTools: [],
				conversationMode: "shared",
				reuseSession: true,
				agentName: "ResidentCoreLettaBot",
			},
		});

		const { session, stream } = await backend.runSession([{ type: "text", text: "Hi bot" }] as never);
		expect(session.conversationId).toBe("conv-bot-live");

		for await (const message of stream()) {
			void message;
			// Exhaust the stream so the terminal status event is emitted.
		}

		expect(ownerMock.runBotSession).toHaveBeenCalledWith(expect.objectContaining({
			message: [{ type: "text", text: "Hi bot" }],
			convKey: undefined,
		}));
		expect(serverEventSinkMock).toHaveBeenCalledWith({
			type: "session.status",
			payload: {
				sessionId: "conv-bot-live",
				status: "running",
				title: "conv-bot-live",
			},
		});
		expect(serverEventSinkMock).toHaveBeenCalledWith({
			type: "stream.user_prompt",
			payload: {
				sessionId: "conv-bot-live",
				prompt: "Hi bot",
			},
		});
		expect(serverEventSinkMock).toHaveBeenCalledWith({
			type: "stream.message",
			payload: {
				sessionId: "conv-bot-live",
				message: expect.objectContaining({
					type: "assistant",
					content: "Hello from bot",
				}),
			},
		});
		expect(serverEventSinkMock).toHaveBeenCalledWith({
			type: "session.status",
			payload: {
				sessionId: "conv-bot-live",
				status: "completed",
				title: "conv-bot-live",
			},
		});
	});

	it("does not emit projection events when bot startup fails before a session is established", async () => {
		const { createResidentCoreSessionBackend } = await import("./resident-core-session-backend.js");
		ownerMock.runBotSession.mockRejectedValueOnce(new Error("bot startup failed"));

		const backend = createResidentCoreSessionBackend({
			owner: ownerMock as never,
			onServerEvent: serverEventSinkMock,
			config: {
				workingDir: "/tmp/workspace",
				allowedTools: [],
				conversationMode: "shared",
				reuseSession: true,
				agentName: "ResidentCoreLettaBot",
			},
		});

		await expect(backend.runSession("hello")).rejects.toThrow("bot startup failed");
		expect(serverEventSinkMock).not.toHaveBeenCalled();
	});
});
