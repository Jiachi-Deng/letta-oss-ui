import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronAppState = vi.hoisted(() => ({
	userDataPath: "/tmp/letta-desktop-test",
}));

const runLettaMock = vi.hoisted(() => vi.fn());
const sessionOwnerMock = vi.hoisted(() => {
	let activeAgentKey = "primary";
	let agents = {
		primary: {
			agentId: "agent-primary",
			lastUsedAt: "2026-04-10T19:00:00.000Z",
			conversationMode: "shared" as const,
		},
		work: {
			agentId: "agent-work",
			lastUsedAt: "2026-04-10T19:05:00.000Z",
		},
	};

	return {
		getActiveAgentKey: vi.fn(() => activeAgentKey),
		getActiveAgentRecord: vi.fn(() => agents[activeAgentKey as keyof typeof agents] ?? null),
		listKnownAgents: vi.fn(() => Object.entries(agents).map(([key, record]) => ({ key, record }))),
		invalidateDesktopSession: vi.fn(),
		switchActiveAgent: vi.fn((key: string) => {
			if (!(key in agents)) return false;
			activeAgentKey = key;
			return true;
		}),
		createManagedAgent: vi.fn(async ({ name }: { name?: string }) => {
			const agentKey = `agent-created-${Object.keys(agents).length + 1}`;
			agents = {
				...agents,
				[agentKey]: {
					agentId: agentKey,
					name,
					lastUsedAt: "2026-04-10T20:00:00.000Z",
					conversationMode: "shared" as const,
				},
			};
			activeAgentKey = agentKey;
			return {
				success: true,
				agentKey,
				activeAgentKey,
				agent: agents[agentKey as keyof typeof agents] ?? null,
				agents: Object.entries(agents).map(([key, record]) => ({ key, record })),
			};
		}),
		renameManagedAgent: vi.fn(async ({ agentKey, name }: { agentKey: string; name: string }) => {
			if (!(agentKey in agents)) {
				return {
					success: false,
					agentKey,
					activeAgentKey,
					agent: agents[activeAgentKey as keyof typeof agents] ?? null,
					agents: Object.entries(agents).map(([key, record]) => ({ key, record })),
					error: `Unknown agent key: ${agentKey}`,
				};
			}
			agents = {
				...agents,
				[agentKey]: {
					...agents[agentKey as keyof typeof agents],
					name,
				},
			};
			return {
				success: true,
				agentKey,
				activeAgentKey,
				agent: agents[activeAgentKey as keyof typeof agents] ?? null,
				agents: Object.entries(agents).map(([key, record]) => ({ key, record })),
			};
		}),
		deleteManagedAgent: vi.fn(async ({ agentKey }: { agentKey: string }) => {
			if (!(agentKey in agents)) {
				return {
					success: false,
					agentKey,
					activeAgentKey,
					agent: agents[activeAgentKey as keyof typeof agents] ?? null,
					agents: Object.entries(agents).map(([key, record]) => ({ key, record })),
					error: `Unknown agent key: ${agentKey}`,
				};
			}
			const nextAgents = { ...agents };
			delete nextAgents[agentKey as keyof typeof nextAgents];
			agents = nextAgents;
			if (activeAgentKey === agentKey) {
				activeAgentKey = Object.keys(agents).sort()[0] ?? "primary";
			}
			return {
				success: true,
				agentKey,
				activeAgentKey,
				agent: agents[activeAgentKey as keyof typeof agents] ?? null,
				agents: Object.entries(agents).map(([key, record]) => ({ key, record })),
			};
		}),
		reset: () => {
			activeAgentKey = "primary";
			agents = {
				primary: {
					agentId: "agent-primary",
					lastUsedAt: "2026-04-10T19:00:00.000Z",
					conversationMode: "shared" as const,
				},
				work: {
					agentId: "agent-work",
					lastUsedAt: "2026-04-10T19:05:00.000Z",
				},
			};
		},
	};
});

vi.mock("electron", () => ({
	app: {
		isPackaged: false,
		getPath: vi.fn((name: string) => {
			if (name === "userData") return electronAppState.userDataPath;
			return "/tmp/letta-desktop-test";
		}),
	},
}));

vi.mock("../runner.js", () => ({
	runLetta: runLettaMock,
}));

describe("ResidentCoreService", () => {
	beforeEach(async () => {
		electronAppState.userDataPath = mkdtempSync(join(tmpdir(), "letta-resident-core-service-"));
		vi.resetModules();
		vi.clearAllMocks();
		sessionOwnerMock.reset();
		const { clearAllSessionProjections } = await import("../runtime-state.js");
		clearAllSessionProjections();
	});

	afterEach(() => {
		rmSync(electronAppState.userDataPath, { recursive: true, force: true });
	});

	it("preserves session projections across cleanup while sanitizing running state", async () => {
		const { getSessionProjection } = await import("../runtime-state.js");
		const {
			readResidentCoreSessionProjectionState,
			writeResidentCoreSessionProjectionState,
		} = await import("./session-projection-persistence.js");
		await writeResidentCoreSessionProjectionState(electronAppState.userDataPath, {
			schemaVersion: 1,
			sessions: [
				{
					conversationId: "conv-core-persist",
					title: "Persisted session",
					status: "running",
					cwd: "/tmp/workspace",
					createdAt: Date.now() - 1000,
					updatedAt: Date.now(),
					messages: [{ type: "user_prompt", prompt: "hello" } as never],
				},
			],
		});

		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock as never);

		await service.cleanupAllSessions();

		expect(getSessionProjection("conv-core-persist")).toMatchObject({
			conversationId: "conv-core-persist",
			title: "Persisted session",
			status: "idle",
			cwd: "/tmp/workspace",
			messages: [{ type: "user_prompt", prompt: "hello" }],
		});
		expect(getSessionProjection("conv-core-persist")?.pendingPermissions.size).toBe(0);
		expect(readResidentCoreSessionProjectionState(electronAppState.userDataPath).sessions).toEqual([
			expect.objectContaining({
				conversationId: "conv-core-persist",
				title: "Persisted session",
				status: "idle",
				messages: [{ type: "user_prompt", prompt: "hello" }],
			}),
		]);
	});

	it("emits the current session list from the shared projection store", async () => {
		const { writeResidentCoreSessionProjectionState } = await import("./session-projection-persistence.js");
		await writeResidentCoreSessionProjectionState(electronAppState.userDataPath, {
			schemaVersion: 1,
			sessions: [
				{
					conversationId: "conv-core-list",
					title: "Core list session",
					status: "running",
					cwd: "/tmp/workspace",
					createdAt: Date.now() - 1000,
					updatedAt: Date.now(),
					messages: [],
				},
			],
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
						status: "idle",
					}),
				]),
			},
		});
	});

	it("emits the active agent info from the resident core registry", async () => {
		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock as never);

		await service.handleClientEvent({ type: "agent.active.get" });

		expect(broadcast).toHaveBeenCalledWith({
			type: "agent.active",
			payload: {
				activeAgentKey: "primary",
				agent: expect.objectContaining({
					agentId: "agent-primary",
					conversationMode: "shared",
				}),
				agents: expect.arrayContaining([
					expect.objectContaining({
						key: "primary",
						record: expect.objectContaining({ agentId: "agent-primary" }),
					}),
				]),
			},
		});
	});

	it("emits the known agent registry entries", async () => {
		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock as never);

		await service.handleClientEvent({ type: "agent.list" });

		expect(broadcast).toHaveBeenCalledWith({
			type: "agent.list",
			payload: {
				activeAgentKey: "primary",
				agents: expect.arrayContaining([
					expect.objectContaining({
						key: "primary",
						record: expect.objectContaining({ agentId: "agent-primary" }),
					}),
					expect.objectContaining({
						key: "work",
						record: expect.objectContaining({ agentId: "agent-work" }),
					}),
				]),
			},
		});
	});

	it("creates a new agent and broadcasts the success result", async () => {
		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock as never);

		await service.handleClientEvent({
			type: "agent.create",
			payload: {
				name: "Companion",
			},
		});

		expect(sessionOwnerMock.createManagedAgent).toHaveBeenCalledWith({
			name: "Companion",
		});
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent.create.result",
				payload: expect.objectContaining({
					success: true,
					activeAgentKey: expect.stringContaining("agent-created-"),
					agent: expect.objectContaining({
						agentId: expect.stringContaining("agent-created-"),
					}),
				}),
			}),
		);
	});

	it("renames an existing agent and broadcasts the success result", async () => {
		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock as never);

		await service.handleClientEvent({
			type: "agent.rename",
			payload: {
				agentKey: "work",
				name: "Renamed Work",
			},
		});

		expect(sessionOwnerMock.renameManagedAgent).toHaveBeenCalledWith({
			agentKey: "work",
			name: "Renamed Work",
		});
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent.rename.result",
				payload: expect.objectContaining({
					success: true,
					agentKey: "work",
					agent: expect.objectContaining({
						agentId: "agent-primary",
					}),
				}),
			}),
		);
	});

	it("deletes the active agent, falls back to another known agent, and broadcasts success", async () => {
		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock as never);

		await service.handleClientEvent({
			type: "agent.delete",
			payload: {
				agentKey: "primary",
			},
		});

		expect(sessionOwnerMock.deleteManagedAgent).toHaveBeenCalledWith({
			agentKey: "primary",
		});
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent.delete.result",
				payload: expect.objectContaining({
					success: true,
					activeAgentKey: "work",
				}),
			}),
		);
	});

	it("emits clean failures for bad create/rename/delete control-plane requests", async () => {
		sessionOwnerMock.createManagedAgent.mockResolvedValueOnce({
			success: false,
			agentKey: "agent-created-failed",
			activeAgentKey: "primary",
			agent: null,
			agents: [],
			error: "create failed",
		});
		sessionOwnerMock.renameManagedAgent.mockResolvedValueOnce({
			success: false,
			agentKey: "missing",
			activeAgentKey: "primary",
			agent: null,
			agents: [],
			error: "Unknown agent key: missing",
		});
		sessionOwnerMock.deleteManagedAgent.mockResolvedValueOnce({
			success: false,
			agentKey: "missing",
			activeAgentKey: "primary",
			agent: null,
			agents: [],
			error: "Unknown agent key: missing",
		});

		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock as never);

		await service.handleClientEvent({ type: "agent.create", payload: {} });
		await service.handleClientEvent({
			type: "agent.rename",
			payload: { agentKey: "missing", name: "Nope" },
		});
		await service.handleClientEvent({
			type: "agent.delete",
			payload: { agentKey: "missing" },
		});

		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent.create.result",
				payload: expect.objectContaining({
					success: false,
					error: "create failed",
				}),
			}),
		);
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent.rename.result",
				payload: expect.objectContaining({
					success: false,
					error: "Unknown agent key: missing",
				}),
			}),
		);
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agent.delete.result",
				payload: expect.objectContaining({
					success: false,
					error: "Unknown agent key: missing",
				}),
			}),
		);
	});

	it("switches the active agent by key and reports success", async () => {
		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock as never);

		await service.handleClientEvent({
			type: "agent.switch",
			payload: {
				agentKey: "work",
			},
		});

		expect(sessionOwnerMock.switchActiveAgent).toHaveBeenCalledWith("work");
		expect(broadcast).toHaveBeenCalledWith({
			type: "agent.switch.result",
			payload: expect.objectContaining({
				success: true,
				activeAgentKey: "work",
				agent: expect.objectContaining({
					agentId: "agent-work",
				}),
			}),
		});
	});

	it("reports a clean failure for unknown agent keys", async () => {
		sessionOwnerMock.switchActiveAgent.mockReturnValueOnce(false);
		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock as never);

		await service.handleClientEvent({
			type: "agent.switch",
			payload: {
				agentKey: "missing",
			},
		});

		expect(sessionOwnerMock.switchActiveAgent).toHaveBeenCalledWith("missing");
		expect(broadcast).toHaveBeenCalledWith({
			type: "agent.switch.result",
			payload: expect.objectContaining({
				success: false,
				activeAgentKey: "primary",
				agent: expect.objectContaining({
					agentId: "agent-primary",
				}),
				error: "Unknown agent key: missing",
			}),
		});
	});

	it("treats switching to the already active agent as a no-op success", async () => {
		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock as never);

		await service.handleClientEvent({
			type: "agent.switch",
			payload: {
				agentKey: "primary",
			},
		});

		expect(sessionOwnerMock.switchActiveAgent).not.toHaveBeenCalled();
		expect(broadcast).toHaveBeenCalledWith({
			type: "agent.switch.result",
			payload: expect.objectContaining({
				success: true,
				activeAgentKey: "primary",
				agent: expect.objectContaining({
					agentId: "agent-primary",
				}),
			}),
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
		const { writeResidentCoreSessionProjectionState } = await import("./session-projection-persistence.js");
		await writeResidentCoreSessionProjectionState(electronAppState.userDataPath, {
			schemaVersion: 1,
			sessions: [
				{
					conversationId: "conv-old",
					title: "Old session",
					status: "idle",
					createdAt: Date.now() - 2000,
					updatedAt: Date.now() - 1000,
					messages: [],
				},
			],
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

		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock);
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

	it("ingests external bot events into the shared session projection path", async () => {
		const broadcast = vi.fn();
		const { createResidentCoreService } = await import("./resident-core.js");
		const { getSessionProjection } = await import("../runtime-state.js");
		const service = createResidentCoreService(broadcast, sessionOwnerMock as never);

		service.ingestServerEvent({
			type: "session.status",
			payload: {
				sessionId: "conv-bot-1",
				status: "running",
				title: "conv-bot-1",
				cwd: "/tmp/workspace",
			},
		});
		service.ingestServerEvent({
			type: "stream.user_prompt",
			payload: {
				sessionId: "conv-bot-1",
				prompt: "hello bot",
			},
		});
		service.ingestServerEvent({
			type: "stream.message",
			payload: {
				sessionId: "conv-bot-1",
				message: { type: "assistant", content: "hi there" } as never,
			},
		});
		service.ingestServerEvent({
			type: "session.status",
			payload: {
				sessionId: "conv-bot-1",
				status: "completed",
				title: "conv-bot-1",
			},
		});

		expect(getSessionProjection("conv-bot-1")).toMatchObject({
			conversationId: "conv-bot-1",
			title: "conv-bot-1",
			status: "completed",
			cwd: "/tmp/workspace",
			messages: [
				{ type: "user_prompt", prompt: "hello bot" },
				{ type: "assistant", content: "hi there" },
			],
		});
		expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
			type: "session.status",
			payload: expect.objectContaining({
				sessionId: "conv-bot-1",
				status: "completed",
			}),
		}));
	});
});
