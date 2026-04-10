import { beforeEach, describe, expect, it, vi } from "vitest";

const createSessionMock = vi.hoisted(() => vi.fn());
const resumeSessionMock = vi.hoisted(() => vi.fn());
const runtimeHostMock = vi.hoisted(() => ({
	getAppConfigState: vi.fn(() => ({ config: {} })),
	prepareRuntimeConnection: vi.fn(async () => ({
		baseUrl: "http://localhost:8283",
		apiKey: "local-dev-key",
		modelHandle: "gpt-4o",
		cliPath: "/tmp/letta-code",
		bootstrapAction: { kind: "none" },
	})),
}));

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

vi.mock("./runtime-host.js", () => ({
	createResidentCoreRuntimeHost: vi.fn(() => runtimeHostMock),
}));

describe("ResidentCoreSessionOwner shared agent identity", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	function makeSession(agentId: string, conversationId: string) {
		return {
			conversationId,
			agentId,
			initialize: vi.fn(async () => undefined),
			send: vi.fn(async () => undefined),
			stream: vi.fn(async function* () {
				yield { type: "result", success: true };
			}),
			close: vi.fn(),
			abort: vi.fn(async () => undefined),
		};
	}

	it("reuses the desktop-created agentId for a later bot conversation", async () => {
		const desktopSession = makeSession("agent-shared", "conv-desktop");
		const botSession = makeSession("agent-shared", "conv-bot");

		createSessionMock.mockImplementation((agentId) => {
			if (agentId === "agent-shared") return botSession as never;
			return desktopSession as never;
		});
		resumeSessionMock.mockImplementation(() => botSession as never);

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		await owner.runDesktopSession({
			prompt: "desktop first",
			session: {
				id: "pending",
				title: "desktop",
				status: "running",
				pendingPermissions: new Map(),
			},
		});

		await owner.runBotSession({
			message: "bot followup",
			config: {
				workingDir: "/tmp/workspace",
				allowedTools: [],
				conversationMode: "shared",
				reuseSession: true,
				agentName: "ResidentCoreLettaBot",
			},
			convKey: "telegram:chat-1",
		});

		expect(owner.getSharedAgentIdentity()).toBe("agent-shared");
		expect(createSessionMock).toHaveBeenNthCalledWith(1, undefined, expect.any(Object));
		expect(createSessionMock).toHaveBeenNthCalledWith(2, "agent-shared", expect.any(Object));
		expect(resumeSessionMock).not.toHaveBeenCalled();
	});

	it("reuses the bot-created agentId for a later desktop conversation", async () => {
		const botSession = makeSession("agent-shared", "conv-bot");
		const desktopSession = makeSession("agent-shared", "conv-desktop");

		createSessionMock.mockImplementation((agentId) => {
			if (agentId === "agent-shared") return desktopSession as never;
			return botSession as never;
		});
		resumeSessionMock.mockImplementation(() => botSession as never);

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		await owner.runBotSession({
			message: "bot first",
			config: {
				workingDir: "/tmp/workspace",
				allowedTools: [],
				conversationMode: "shared",
				reuseSession: true,
				agentName: "ResidentCoreLettaBot",
			},
			convKey: "telegram:chat-1",
		});

		await owner.runDesktopSession({
			prompt: "desktop followup",
			session: {
				id: "pending",
				title: "desktop",
				status: "running",
				pendingPermissions: new Map(),
			},
		});

		expect(owner.getSharedAgentIdentity()).toBe("agent-shared");
		expect(createSessionMock).toHaveBeenNthCalledWith(1, undefined, expect.any(Object));
		expect(createSessionMock).toHaveBeenNthCalledWith(2, "agent-shared", expect.any(Object));
		expect(resumeSessionMock).not.toHaveBeenCalled();
	});

	it("does not reinitialize an existing bot session when reusing the same convKey", async () => {
		const botSession = makeSession("agent-shared", "conv-bot");

		createSessionMock.mockImplementation(() => botSession as never);
		resumeSessionMock.mockImplementation(() => botSession as never);

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });
		const config = {
			workingDir: "/tmp/workspace",
			allowedTools: [],
			conversationMode: "shared",
			reuseSession: true,
			agentName: "ResidentCoreLettaBot",
		};

		await owner.runBotSession({
			message: "bot first",
			config,
			convKey: "telegram:chat-1",
		});

		expect(botSession.initialize).toHaveBeenCalledTimes(1);

		await owner.runBotSession({
			message: "bot second",
			config,
			convKey: "telegram:chat-1",
		});

		expect(botSession.initialize).toHaveBeenCalledTimes(1);
		expect(botSession.send).toHaveBeenCalledTimes(2);
		expect(createSessionMock).toHaveBeenCalledTimes(1);
		expect(resumeSessionMock).not.toHaveBeenCalled();
	});

	it("resumes desktop follow-up turns by conversationId instead of reusing the prior closed session object", async () => {
		const initialDesktopSession = makeSession("agent-shared", "conv-desktop");
		const resumedDesktopSession = makeSession("agent-shared", "conv-desktop");

		createSessionMock.mockImplementation(() => initialDesktopSession as never);
		resumeSessionMock.mockImplementation(() => resumedDesktopSession as never);

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		await owner.runDesktopSession({
			prompt: "desktop first",
			session: {
				id: "pending",
				title: "desktop",
				status: "running",
				pendingPermissions: new Map(),
			},
		});

		await owner.runDesktopSession({
			prompt: "desktop second",
			session: {
				id: "conv-desktop",
				title: "desktop",
				status: "running",
				pendingPermissions: new Map(),
			},
			resumeConversationId: "conv-desktop",
		});

		expect(createSessionMock).toHaveBeenCalledTimes(1);
		expect(resumeSessionMock).toHaveBeenCalledTimes(1);
		expect(resumeSessionMock).toHaveBeenCalledWith("conv-desktop", expect.any(Object));
		expect(initialDesktopSession.send).toHaveBeenCalledTimes(1);
		expect(resumedDesktopSession.send).toHaveBeenCalledTimes(1);
	});
});
