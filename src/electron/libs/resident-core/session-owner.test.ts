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

	it("passes the desktop session cwd through to the runtime session options", async () => {
		const desktopSession = makeSession("agent-shared", "conv-desktop");
		createSessionMock.mockImplementation(() => desktopSession as never);

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		await owner.runDesktopSession({
			prompt: "desktop first",
			session: {
				id: "pending",
				title: "desktop",
				status: "running",
				cwd: "/Users/jachi/Documents/OnlySpecs",
				pendingPermissions: new Map(),
			},
		});

		expect(createSessionMock).toHaveBeenCalledWith(
			undefined,
			expect.objectContaining({
				cwd: "/Users/jachi/Documents/OnlySpecs",
			}),
		);
	});

	it("retries a desktop run with a fresh session when the init message is missing", async () => {
		const failingSession = makeSession("agent-shared", "conv-desktop");
		failingSession.send = vi.fn(async () => {
			throw new Error("Failed to initialize session - no init message received");
		});
		const retryingSession = makeSession("agent-shared", "conv-desktop-2");
		retryingSession.send = vi.fn(async () => {
			throw new Error("Failed to initialize session - no init message received");
		});
		const recoveredSession = makeSession("agent-shared", "conv-desktop-3");

		createSessionMock
			.mockImplementationOnce(() => failingSession as never)
			.mockImplementationOnce(() => retryingSession as never)
			.mockImplementationOnce(() => recoveredSession as never);

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		await owner.runDesktopSession({
			prompt: "desktop first",
			session: {
				id: "pending",
				title: "desktop",
				status: "running",
				cwd: "/Users/jachi/Documents/OnlySpecs",
				pendingPermissions: new Map(),
			},
		});

		expect(createSessionMock).toHaveBeenCalledTimes(3);
		expect(failingSession.close).toHaveBeenCalledTimes(1);
		expect(retryingSession.close).toHaveBeenCalledTimes(1);
		expect(failingSession.send).toHaveBeenCalledTimes(1);
		expect(retryingSession.send).toHaveBeenCalledTimes(1);
		expect(recoveredSession.send).toHaveBeenCalledTimes(1);
		expect(createSessionMock).toHaveBeenNthCalledWith(
			3,
			undefined,
			expect.objectContaining({
				cwd: "/Users/jachi/Documents/OnlySpecs",
			}),
		);
	});

	it("records a desktop run failure after exhausting init retries", async () => {
		const diagnostics = await import("../diagnostics.js");
		diagnostics.resetDiagnosticsForTests();
		const failingSession = makeSession("agent-shared", "conv-desktop");
		failingSession.send = vi.fn(async () => {
			throw new Error("Failed to initialize session - no init message received");
		});

		createSessionMock.mockImplementation(() => ({
			...failingSession,
			send: vi.fn(async () => {
				throw new Error("Failed to initialize session - no init message received");
			}),
			close: vi.fn(),
		}) as never);

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		await expect(owner.runDesktopSession({
			prompt: "desktop fail",
			session: {
				id: "pending",
				title: "desktop",
				status: "running",
				cwd: "/Users/jachi/Documents/OnlySpecs",
				pendingPermissions: new Map(),
			},
			trace: { traceId: "trc_rc_desktop_init_retry_fail" } as never,
		})).rejects.toThrow("Failed to initialize session - no init message received");

		expect(diagnostics.getDiagnosticSummary("trc_rc_desktop_init_retry_fail")).toMatchObject({
			errorCode: "E_RESIDENT_CORE_DESKTOP_RUN_FAILED",
			firstFailedDecisionId: "RC_DESKTOP_RUN_004",
		});
	});

	it("records diagnostics for Resident Core desktop session failures", async () => {
		const diagnostics = await import("../diagnostics.js");
		diagnostics.resetDiagnosticsForTests();
		const failingSession = makeSession("agent-shared", "conv-desktop");
		failingSession.send = vi.fn(async () => {
			throw new Error("desktop send failed");
		});

		createSessionMock.mockImplementation(() => failingSession as never);
		resumeSessionMock.mockImplementation(() => failingSession as never);

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		await expect(owner.runDesktopSession({
			prompt: "desktop fail",
			session: {
				id: "pending",
				title: "desktop",
				status: "running",
				pendingPermissions: new Map(),
			},
			trace: { traceId: "trc_rc_desktop_fail" } as never,
		})).rejects.toThrow("desktop send failed");

		expect(diagnostics.getDiagnosticSummary("trc_rc_desktop_fail")).toMatchObject({
			errorCode: "E_RESIDENT_CORE_DESKTOP_RUN_FAILED",
			firstFailedDecisionId: "RC_DESKTOP_RUN_004",
		});
	});

	it("records diagnostics for Resident Core bot ensure failures", async () => {
		const diagnostics = await import("../diagnostics.js");
		diagnostics.resetDiagnosticsForTests();
		const failingSession = makeSession("agent-shared", "conv-bot");
		failingSession.initialize = vi.fn(async () => {
			throw new Error("bot init failed");
		});

		createSessionMock.mockImplementation(() => failingSession as never);
		resumeSessionMock.mockImplementation(() => failingSession as never);

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		await expect(owner.ensureBotSessionForKey({
			config: {
				workingDir: "/tmp/workspace",
				allowedTools: [],
				conversationMode: "shared",
				reuseSession: true,
				agentName: "ResidentCoreLettaBot",
			},
			convKey: "telegram:chat-1",
			trace: { traceId: "trc_rc_bot_ensure_fail" } as never,
		})).rejects.toThrow("bot init failed");

		expect(diagnostics.getDiagnosticSummary("trc_rc_bot_ensure_fail")).toMatchObject({
			errorCode: "E_RESIDENT_CORE_BOT_ENSURE_FAILED",
			firstFailedDecisionId: "RC_BOT_ENSURE_003",
		});
	});
});
