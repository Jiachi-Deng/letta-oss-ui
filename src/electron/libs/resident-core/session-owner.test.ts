import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readResidentCoreState, writeResidentCoreState } from "./state-store.js";

const createAgentMock = vi.hoisted(() => vi.fn());
const lettaAgentsUpdateMock = vi.hoisted(() => vi.fn());
const lettaAgentsDeleteMock = vi.hoisted(() => vi.fn());
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
const electronAppState = vi.hoisted(() => ({
	userDataPath: "/tmp/letta-desktop-test",
}));

vi.mock("electron", () => ({
	app: {
		isPackaged: false,
		getPath: vi.fn((name: string) => {
			if (name === "userData") return electronAppState.userDataPath;
			return "/tmp/letta-desktop-test";
		}),
	},
}));

vi.mock("@letta-ai/letta-code-sdk", () => ({
	createAgent: createAgentMock,
	createSession: createSessionMock,
	resumeSession: resumeSessionMock,
}));

vi.mock("@letta-ai/letta-client", () => ({
	default: class MockLetta {
		agents = {
			update: lettaAgentsUpdateMock,
			delete: lettaAgentsDeleteMock,
		};
	}
}));

vi.mock("./runtime-host.js", () => ({
	createResidentCoreRuntimeHost: vi.fn(() => runtimeHostMock),
}));

describe("ResidentCoreSessionOwner shared agent identity", () => {
	let userDataPath: string;

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		createAgentMock.mockResolvedValue("agent-created");
		lettaAgentsUpdateMock.mockResolvedValue(undefined);
		lettaAgentsDeleteMock.mockResolvedValue(undefined);
		userDataPath = mkdtempSync(join(tmpdir(), "letta-resident-core-"));
		electronAppState.userDataPath = userDataPath;
	});

	afterEach(() => {
		rmSync(userDataPath, { recursive: true, force: true });
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

	it("restores the persisted active agentId on startup and passes it into the first session", async () => {
		writeResidentCoreState(userDataPath, {
			schemaVersion: 1,
			activeAgentKey: "primary",
			agents: {
				primary: {
					agentId: "agent-persisted",
					lastUsedAt: new Date().toISOString(),
					conversationMode: "shared",
				},
			},
		});

		const desktopSession = makeSession("agent-persisted", "conv-desktop");
		createSessionMock.mockImplementation(() => desktopSession as never);

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

		expect(createSessionMock).toHaveBeenCalledWith("agent-persisted", expect.any(Object));
		expect(owner.getSharedAgentIdentity()).toBe("agent-persisted");
	});

	it("exposes active agent metadata and the known registry entries", async () => {
		writeResidentCoreState(userDataPath, {
			schemaVersion: 1,
			activeAgentKey: "primary",
			agents: {
				primary: {
					agentId: "agent-primary",
					lastUsedAt: "2026-04-10T19:00:00.000Z",
					conversationMode: "shared",
				},
				work: {
					agentId: "agent-work",
					lastUsedAt: "2026-04-10T19:05:00.000Z",
				},
			},
		});

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		expect(owner.getActiveAgentKey()).toBe("primary");
		expect(owner.getActiveAgentRecord()).toMatchObject({
			agentId: "agent-primary",
			lastUsedAt: "2026-04-10T19:00:00.000Z",
			conversationMode: "shared",
		});
		expect(owner.listKnownAgents().map(({ key, record }) => [key, record.agentId])).toEqual([
			["primary", "agent-primary"],
			["work", "agent-work"],
		]);
	});

	it("creates a new agent through the SDK and persists the new active registry entry", async () => {
		createAgentMock.mockResolvedValueOnce("agent-created-1");

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		const result = await owner.createManagedAgent({ name: "Companion" });

		expect(createAgentMock).toHaveBeenCalledWith({ model: "gpt-4o" });
		expect(lettaAgentsUpdateMock).toHaveBeenCalledWith("agent-created-1", { name: "Companion" });
		expect(result).toMatchObject({
			success: true,
			agentKey: "agent-created-1",
			activeAgentKey: "agent-created-1",
			agent: expect.objectContaining({
				agentId: "agent-created-1",
				name: "Companion",
			}),
		});
		expect(owner.getActiveAgentKey()).toBe("agent-created-1");
		expect(owner.getSharedAgentIdentity()).toBe("agent-created-1");
		expect(owner.listKnownAgents()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "agent-created-1",
					record: expect.objectContaining({
						agentId: "agent-created-1",
						name: "Companion",
					}),
				}),
			]),
		);
	});

	it("renames an existing agent and updates the durable registry", async () => {
		writeResidentCoreState(userDataPath, {
			schemaVersion: 1,
			activeAgentKey: "primary",
			agents: {
				primary: {
					agentId: "agent-primary",
					lastUsedAt: "2026-04-10T19:00:00.000Z",
					conversationMode: "shared",
				},
				work: {
					agentId: "agent-work",
					name: "Old Name",
					lastUsedAt: "2026-04-10T19:05:00.000Z",
				},
			},
		});

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		const result = await owner.renameManagedAgent({
			agentKey: "work",
			name: "Renamed Work",
		});

		expect(lettaAgentsUpdateMock).toHaveBeenCalledWith("agent-work", { name: "Renamed Work" });
		expect(result).toMatchObject({
			success: true,
			agentKey: "work",
			activeAgentKey: "primary",
		});
		expect(owner.listKnownAgents()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "work",
					record: expect.objectContaining({
						agentId: "agent-work",
						name: "Renamed Work",
					}),
				}),
			]),
		);
	});

	it("deletes the active agent, falls back to another registry entry, and clears caches", async () => {
		writeResidentCoreState(userDataPath, {
			schemaVersion: 1,
			activeAgentKey: "primary",
			agents: {
				primary: {
					agentId: "agent-primary",
					lastUsedAt: "2026-04-10T19:00:00.000Z",
				},
				work: {
					agentId: "agent-work",
					lastUsedAt: "2026-04-10T19:05:00.000Z",
				},
			},
		});

		const desktopSession = makeSession("agent-primary", "conv-delete");
		createSessionMock.mockImplementation(() => desktopSession as never);

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });
		await owner.runDesktopSession({
			prompt: "seed session",
			session: {
				id: "pending",
				title: "desktop",
				status: "running",
				pendingPermissions: new Map(),
			},
		});

		const result = await owner.deleteManagedAgent({ agentKey: "primary" });

		expect(lettaAgentsDeleteMock).toHaveBeenCalledWith("agent-primary");
		expect(result).toMatchObject({
			success: true,
			agentKey: "primary",
			activeAgentKey: "work",
		});
		expect(owner.getActiveAgentKey()).toBe("work");
		expect(owner.listKnownAgents().map(({ key }) => key)).toEqual(["work"]);
		expect(desktopSession.close).toHaveBeenCalledTimes(1);
	});

	it("treats a remote 404 on delete as a clean local delete", async () => {
		writeResidentCoreState(userDataPath, {
			schemaVersion: 1,
			activeAgentKey: "primary",
			agents: {
				primary: {
					agentId: "agent-primary",
					lastUsedAt: "2026-04-10T19:00:00.000Z",
				},
				work: {
					agentId: "agent-work",
					lastUsedAt: "2026-04-10T19:05:00.000Z",
				},
			},
		});
		lettaAgentsDeleteMock.mockRejectedValueOnce(new Error("404 agent not found"));

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		const result = await owner.deleteManagedAgent({ agentKey: "primary" });

		expect(lettaAgentsDeleteMock).toHaveBeenCalledWith("agent-primary");
		expect(result).toMatchObject({
			success: true,
			agentKey: "primary",
			activeAgentKey: "work",
		});
		expect(owner.listKnownAgents().map(({ key }) => key)).toEqual(["work"]);
	});

	it("returns clean failures for create, rename, and delete management operations", async () => {
		createAgentMock.mockRejectedValueOnce(new Error("create failed"));
		lettaAgentsUpdateMock.mockRejectedValueOnce(new Error("rename failed"));
		lettaAgentsDeleteMock.mockRejectedValueOnce(new Error("delete failed"));

		writeResidentCoreState(userDataPath, {
			schemaVersion: 1,
			activeAgentKey: "primary",
			agents: {
				primary: {
					agentId: "agent-primary",
					lastUsedAt: "2026-04-10T19:00:00.000Z",
				},
			},
		});

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const owner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		await expect(owner.createManagedAgent({ name: "Broken" })).resolves.toMatchObject({
			success: false,
			error: "create failed",
		});
		await expect(owner.renameManagedAgent({ agentKey: "missing", name: "Nope" })).resolves.toMatchObject({
			success: false,
			error: "Unknown agent key: missing",
		});
		await expect(owner.deleteManagedAgent({ agentKey: "missing" })).resolves.toMatchObject({
			success: false,
			error: "Unknown agent key: missing",
		});
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

	it("switches to another known agent key and uses that agentId for subsequent desktop runs", async () => {
		writeResidentCoreState(userDataPath, {
			schemaVersion: 1,
			activeAgentKey: "primary",
			agents: {
				primary: {
					agentId: "agent-primary",
					lastUsedAt: "2026-04-10T19:00:00.000Z",
					conversationMode: "shared",
				},
				work: {
					agentId: "agent-work",
					lastUsedAt: "2026-04-10T19:05:00.000Z",
				},
			},
		});

		const primarySession = makeSession("agent-primary", "conv-desktop");
		const workSession = makeSession("agent-work", "conv-desktop");

		createSessionMock.mockImplementation((agentId) => {
			if (agentId === "agent-work") return workSession as never;
			return primarySession as never;
		});

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

		expect(createSessionMock).toHaveBeenNthCalledWith(1, "agent-primary", expect.any(Object));
		expect(owner.switchActiveAgent("work")).toBe(true);
		expect(owner.getActiveAgentKey()).toBe("work");
		expect(owner.getActiveAgentRecord()).toMatchObject({ agentId: "agent-work" });
		expect(primarySession.close).toHaveBeenCalledTimes(1);

		await owner.runDesktopSession({
			prompt: "desktop second",
			session: {
				id: "pending",
				title: "desktop",
				status: "running",
				pendingPermissions: new Map(),
			},
		});

		expect(createSessionMock).toHaveBeenNthCalledWith(2, "agent-work", expect.any(Object));
		expect(workSession.send).toHaveBeenCalledTimes(1);
	});

	it("switching clears stale bot session caches so a later bot run uses the new active agent", async () => {
		writeResidentCoreState(userDataPath, {
			schemaVersion: 1,
			activeAgentKey: "primary",
			agents: {
				primary: {
					agentId: "agent-primary",
					lastUsedAt: "2026-04-10T19:00:00.000Z",
				},
				work: {
					agentId: "agent-work",
					lastUsedAt: "2026-04-10T19:05:00.000Z",
				},
			},
		});

		const primaryBotSession = makeSession("agent-primary", "conv-bot");
		const workBotSession = makeSession("agent-work", "conv-bot");

		createSessionMock.mockImplementation((agentId) => {
			if (agentId === "agent-work") return workBotSession as never;
			return primaryBotSession as never;
		});

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

		expect(createSessionMock).toHaveBeenNthCalledWith(1, "agent-primary", expect.any(Object));
		expect(owner.getBotSession("telegram:chat-1")).toBe(primaryBotSession as never);

		expect(owner.switchActiveAgent("work")).toBe(true);
		expect(primaryBotSession.close).toHaveBeenCalledTimes(1);
		expect(owner.getBotSession("telegram:chat-1")).toBeUndefined();

		await owner.runBotSession({
			message: "bot second",
			config,
			convKey: "telegram:chat-1",
		});

		expect(createSessionMock).toHaveBeenNthCalledWith(2, "agent-work", expect.any(Object));
		expect(workBotSession.send).toHaveBeenCalledTimes(1);
	});

	it("persists the first discovered agentId and reuses it after recreating the owner", async () => {
		const desktopSession = makeSession("agent-shared", "conv-desktop");
		createSessionMock.mockImplementation(() => desktopSession as never);

		const { createResidentCoreSessionOwner } = await import("./session-owner.js");
		const firstOwner = createResidentCoreSessionOwner({ runtimeHost: runtimeHostMock as never });

		await firstOwner.runDesktopSession({
			prompt: "desktop first",
			session: {
				id: "pending",
				title: "desktop",
				status: "running",
				pendingPermissions: new Map(),
			},
		});

		expect(readResidentCoreState(userDataPath).agents.primary.agentId).toBe("agent-shared");

		const secondDesktopSession = makeSession("agent-shared", "conv-desktop-2");
		createSessionMock.mockReset();
		createSessionMock.mockImplementation(() => secondDesktopSession as never);
		resumeSessionMock.mockReset();

		vi.resetModules();
		const { createResidentCoreSessionOwner: createResidentCoreSessionOwnerReloaded } = await import("./session-owner.js");
		const secondOwner = createResidentCoreSessionOwnerReloaded({ runtimeHost: runtimeHostMock as never });

		await secondOwner.runDesktopSession({
			prompt: "desktop second",
			session: {
				id: "pending-2",
				title: "desktop",
				status: "running",
				pendingPermissions: new Map(),
			},
		});

		expect(createSessionMock).toHaveBeenCalledWith("agent-shared", expect.any(Object));
		expect(secondOwner.getSharedAgentIdentity()).toBe("agent-shared");
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
