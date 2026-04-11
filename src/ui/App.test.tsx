// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useAppStore } from "./store/useAppStore";
import type { ServerEvent } from "./types";

vi.mock("./components/Sidebar", () => ({
	Sidebar: ({
		onNewSession,
		onOpenDiagnostics,
		activeView,
	}: {
		onNewSession: () => void;
		onOpenDiagnostics: () => void;
		activeView: "chat" | "diagnostics";
	}) => (
		<div>
			<button onClick={onNewSession} type="button">
				New Task
			</button>
			<button onClick={onOpenDiagnostics} type="button">
				{activeView === "diagnostics" ? "Diagnostics Active" : "Diagnostics"}
			</button>
		</div>
	),
}));

vi.mock("./components/EventCard", () => ({
	MessageCard: () => <div data-testid="message-card" />,
}));

vi.mock("./components/OnboardingModal", () => ({
	OnboardingModal: () => <div data-testid="onboarding-modal" />,
}));

vi.mock("./render/markdown", () => ({
	default: ({ text }: { text: string }) => <div>{text}</div>,
}));

function resetAppStore() {
  useAppStore.setState({
    sessions: {},
    activeSessionId: null,
    activeAgentKey: null,
    activeAgent: null,
    knownAgents: [],
    agentSwitchError: null,
    agentMutationError: null,
    prompt: "",
    cwd: "",
    pendingStart: false,
		globalError: null,
		sessionsLoaded: false,
		showStartModal: false,
		historyRequested: new Set(),
	});
}

describe("App", () => {
	let serverEventHandler: ((event: ServerEvent) => void) | null;
	let sendClientEventMock: ReturnType<typeof vi.fn>;
	let getStaticDataMock: ReturnType<typeof vi.fn>;
	let listDiagnosticSummariesMock: ReturnType<typeof vi.fn>;
	let getDiagnosticSummaryMock: ReturnType<typeof vi.fn>;
	let getLatestDiagnosticSummaryForSessionMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		resetAppStore();
		serverEventHandler = null;
		sendClientEventMock = vi.fn();
		getDiagnosticSummaryMock = vi.fn().mockResolvedValue(null);
		getLatestDiagnosticSummaryForSessionMock = vi.fn().mockResolvedValue(null);
		listDiagnosticSummariesMock = vi.fn().mockResolvedValue([]);
		getStaticDataMock = vi.fn().mockResolvedValue({
			totalStorage: 512,
			cpuModel: "Apple M3",
			totalMemoryGB: 18,
			codeIsland: {
				platformSupported: true,
				available: true,
				status: "launched",
				running: true,
			},
		});

		Object.defineProperty(window, "electron", {
			value: {
				getAppConfig: vi.fn().mockResolvedValue({
					mode: "packaged",
					source: "packaged-config",
					config: {
						connectionType: "letta-server",
						LETTA_BASE_URL: "https://api.letta.com",
					},
					canEdit: true,
					requiresOnboarding: false,
				}),
				getStaticData: getStaticDataMock,
				listDiagnosticSummaries: listDiagnosticSummariesMock,
				getDiagnosticSummary: getDiagnosticSummaryMock,
				getLatestDiagnosticSummaryForSession: getLatestDiagnosticSummaryForSessionMock,
				getRecentCwds: vi.fn().mockResolvedValue([]),
				selectDirectory: vi.fn().mockResolvedValue(null),
				saveAppConfig: vi.fn(),
				sendClientEvent: sendClientEventMock,
				onServerEvent: vi.fn((callback: (event: ServerEvent) => void) => {
					serverEventHandler = callback;
					return vi.fn();
				}),
				subscribeStatistics: vi.fn(() => vi.fn()),
			},
			configurable: true,
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	async function emitServerEvent(event: ServerEvent) {
		if (!serverEventHandler) {
			throw new Error("Server event handler was not registered");
		}

		await act(async () => {
			serverEventHandler?.(event);
		});
	}

  it("keeps the prompt input enabled for an empty selected session", async () => {
		useAppStore.setState({
			sessions: {
				"session-empty": {
					id: "session-empty",
					title: "Empty session",
					status: "idle",
					cwd: "/tmp/project",
					messages: [],
					permissionRequests: [],
					hydrated: true,
				},
			},
			activeSessionId: "session-empty",
		});

    render(<App />);

    await waitFor(() => {
      expect(sendClientEventMock).toHaveBeenCalledWith({ type: "session.list" });
      expect(sendClientEventMock).toHaveBeenCalledWith({ type: "agent.active.get" });
    });

    const promptInput = await screen.findByPlaceholderText(
      "Describe what you want agent to handle...",
    );
		const sendButton = screen.getByRole("button", { name: "Send prompt" });

    expect(promptInput).toBeEnabled();
    expect(sendButton).toBeEnabled();
    expect(screen.getByText("No messages yet")).toBeInTheDocument();
  });

  it("updates the agent registry state from resident core events", async () => {
    render(<App />);

    await emitServerEvent({
      type: "agent.active",
      payload: {
        activeAgentKey: "primary",
        agent: {
          agentId: "agent-primary-123456",
          lastUsedAt: "2026-04-10T19:00:00.000Z",
          conversationMode: "shared",
        },
        agents: [
          {
            key: "primary",
            record: {
              agentId: "agent-primary-123456",
              lastUsedAt: "2026-04-10T19:00:00.000Z",
              conversationMode: "shared",
            },
          },
          {
            key: "work",
            record: {
              agentId: "agent-work-abcdef",
              lastUsedAt: "2026-04-10T19:05:00.000Z",
            },
          },
        ],
      },
    });

    expect(useAppStore.getState()).toMatchObject({
      activeAgentKey: "primary",
      activeAgent: {
        agentId: "agent-primary-123456",
      },
      knownAgents: expect.arrayContaining([
        expect.objectContaining({
          key: "primary",
          record: expect.objectContaining({ agentId: "agent-primary-123456" }),
        }),
      ]),
      agentSwitchError: null,
    });

    await emitServerEvent({
      type: "agent.list",
      payload: {
        activeAgentKey: "work",
        agents: [
          {
            key: "work",
            record: {
              agentId: "agent-work-abcdef",
              lastUsedAt: "2026-04-10T19:05:00.000Z",
            },
          },
        ],
      },
    });

    expect(useAppStore.getState()).toMatchObject({
      activeAgentKey: "work",
      knownAgents: [
        {
          key: "work",
          record: {
            agentId: "agent-work-abcdef",
            lastUsedAt: "2026-04-10T19:05:00.000Z",
          },
        },
      ],
    });

    await emitServerEvent({
      type: "agent.switch.result",
      payload: {
        success: false,
        activeAgentKey: "work",
        agent: {
          agentId: "agent-work-abcdef",
          lastUsedAt: "2026-04-10T19:05:00.000Z",
        },
        agents: [
          {
            key: "work",
            record: {
              agentId: "agent-work-abcdef",
              lastUsedAt: "2026-04-10T19:05:00.000Z",
            },
          },
        ],
        error: "Unknown agent key: missing",
      },
    });

    expect(useAppStore.getState()).toMatchObject({
      activeAgentKey: "work",
      agentSwitchError: "Unknown agent key: missing",
    });
  });

  it("applies create, rename, and delete registry results from resident core events", async () => {
    render(<App />);

    await emitServerEvent({
      type: "agent.create.result",
      payload: {
        success: true,
        agentKey: "agent-new",
        activeAgentKey: "agent-new",
        agent: {
          agentId: "agent-new",
          name: "New Agent",
          lastUsedAt: "2026-04-10T20:00:00.000Z",
          conversationMode: "shared",
        },
        agents: [
          {
            key: "agent-new",
            record: {
              agentId: "agent-new",
              name: "New Agent",
              lastUsedAt: "2026-04-10T20:00:00.000Z",
              conversationMode: "shared",
            },
          },
        ],
      },
    });

    expect(useAppStore.getState()).toMatchObject({
      activeAgentKey: "agent-new",
      activeAgent: {
        agentId: "agent-new",
        name: "New Agent",
      },
      knownAgents: [
        {
          key: "agent-new",
          record: {
            agentId: "agent-new",
            name: "New Agent",
          },
        },
      ],
      agentMutationError: null,
    });

    await emitServerEvent({
      type: "agent.rename.result",
      payload: {
        success: true,
        agentKey: "agent-new",
        activeAgentKey: "agent-new",
        agent: {
          agentId: "agent-new",
          name: "Renamed Agent",
          lastUsedAt: "2026-04-10T20:05:00.000Z",
          conversationMode: "shared",
        },
        agents: [
          {
            key: "agent-new",
            record: {
              agentId: "agent-new",
              name: "Renamed Agent",
              lastUsedAt: "2026-04-10T20:05:00.000Z",
              conversationMode: "shared",
            },
          },
        ],
      },
    });

    expect(useAppStore.getState()).toMatchObject({
      activeAgentKey: "agent-new",
      activeAgent: {
        agentId: "agent-new",
        name: "Renamed Agent",
      },
      knownAgents: [
        {
          key: "agent-new",
          record: {
            agentId: "agent-new",
            name: "Renamed Agent",
          },
        },
      ],
      agentMutationError: null,
    });

    await emitServerEvent({
      type: "agent.delete.result",
      payload: {
        success: true,
        agentKey: "agent-new",
        activeAgentKey: "primary",
        agent: {
          agentId: "agent-primary-123456",
          name: "Companion",
          lastUsedAt: "2026-04-10T20:10:00.000Z",
          conversationMode: "shared",
        },
        agents: [
          {
            key: "primary",
            record: {
              agentId: "agent-primary-123456",
              name: "Companion",
              lastUsedAt: "2026-04-10T20:10:00.000Z",
              conversationMode: "shared",
            },
          },
        ],
      },
    });

    expect(useAppStore.getState()).toMatchObject({
      activeAgentKey: "primary",
      activeAgent: {
        agentId: "agent-primary-123456",
        name: "Companion",
      },
      knownAgents: [
        {
          key: "primary",
          record: {
            agentId: "agent-primary-123456",
            name: "Companion",
          },
        },
      ],
      agentMutationError: null,
    });
  });

	it("shows a clear warning when CodeIsland is unsupported on this macOS version", async () => {
		getStaticDataMock.mockResolvedValue({
			totalStorage: 512,
			cpuModel: "Apple M3",
			totalMemoryGB: 18,
			codeIsland: {
				platformSupported: false,
				available: false,
				status: "unsupported",
				running: false,
				systemVersion: "13.6.9",
				minimumMacOSVersion: "14.0",
				diagnostic: {
					code: "macos-version-too-old",
					summary: "CodeIsland requires macOS 14+ but this Mac is running macOS 13.6.9.",
					action: "Update the machine to macOS 14 or later to enable the CodeIsland companion. Letta chat will keep working without it.",
				},
			},
		});

		render(<App />);

		expect(await screen.findByText(/CodeIsland requires macOS 14\+/)).toBeInTheDocument();
		expect(screen.getByText(/Letta chat will keep working without it/)).toBeInTheDocument();
	});

	it("shows first-launch security guidance when CodeIsland launch verification fails", async () => {
		getDiagnosticSummaryMock.mockResolvedValue({
			traceId: "trc_codeisland",
			summary: "Trace failed at CI_BOOT_004 after CI_BOOT_003.",
			errorCode: "E_CODEISLAND_LAUNCH_BLOCKED",
			lastSuccessfulDecisionId: "CI_BOOT_003",
			firstFailedDecisionId: "CI_BOOT_004",
			suggestedAction: "Open the nested CodeIsland.app once and approve it in System Settings > Privacy & Security, then relaunch Letta.",
			steps: [
				{
					component: "bundled-codeisland",
					decisionId: "CI_BOOT_003",
					status: "ok",
					message: "Launching CodeIsland via open command",
				},
				{
					component: "bundled-codeisland",
					decisionId: "CI_BOOT_004",
					status: "error",
					message: "CodeIsland failed launch verification",
					errorCode: "E_CODEISLAND_LAUNCH_BLOCKED",
				},
			],
		});
		getStaticDataMock.mockResolvedValue({
			totalStorage: 512,
			cpuModel: "Apple M3",
			totalMemoryGB: 18,
			codeIsland: {
				platformSupported: true,
				available: true,
				status: "failed",
				running: false,
				resolution: {
					appPath: "/Applications/Letta.app/Contents/Resources/CodeIsland.app",
					source: "bundled",
				},
				diagnostic: {
					code: "launch-verification-failed",
					summary: "CodeIsland was found but macOS appears to be blocking its first launch.",
					action: "Open \"/Applications/Letta.app/Contents/Resources/CodeIsland.app\" once in Finder or run 'open \"/Applications/Letta.app/Contents/Resources/CodeIsland.app\"', approve any macOS security prompt in System Settings > Privacy & Security, then relaunch Letta.",
				},
				traceId: "trc_codeisland",
			},
		});

		render(<App />);

		expect(await screen.findByText(/macOS appears to be blocking its first launch/)).toBeInTheDocument();
		expect(screen.getByText(/Privacy & Security/)).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "Copy diagnostics" })).toBeInTheDocument();
	});

	it("copies CodeIsland diagnostics from the warning banner", async () => {
		const user = userEvent.setup();
		getDiagnosticSummaryMock.mockResolvedValue({
			traceId: "trc_codeisland_copy",
			turnId: "turn_codeisland_copy",
			summary: "Trace failed at CI_BOOT_004 after CI_BOOT_003.",
			errorCode: "E_CODEISLAND_LAUNCH_BLOCKED",
			lastSuccessfulDecisionId: "CI_BOOT_003",
			firstFailedDecisionId: "CI_BOOT_004",
			suggestedAction: "Open the nested CodeIsland.app once and approve it in System Settings > Privacy & Security, then relaunch Letta.",
			steps: [
				{
					component: "bundled-codeisland",
					decisionId: "CI_BOOT_004",
					status: "error",
					message: "CodeIsland failed launch verification",
					errorCode: "E_CODEISLAND_LAUNCH_BLOCKED",
				},
			],
		});
		getStaticDataMock.mockResolvedValue({
			totalStorage: 512,
			cpuModel: "Apple M3",
			totalMemoryGB: 18,
			codeIsland: {
				platformSupported: true,
				available: true,
				status: "failed",
				running: false,
				traceId: "trc_codeisland_copy",
				diagnostic: {
					code: "launch-verification-failed",
					summary: "CodeIsland was found but macOS appears to be blocking its first launch.",
				},
			},
		});

		render(<App />);

		await user.click(await screen.findByRole("button", { name: "Copy diagnostics" }));

		expect(getDiagnosticSummaryMock).toHaveBeenCalledWith("trc_codeisland_copy");
		await waitFor(async () => {
			await expect(navigator.clipboard.readText()).resolves.toContain("Trace ID: trc_codeisland_copy");
		});
		await expect(navigator.clipboard.readText()).resolves.toContain("First Failed Decision: CI_BOOT_004");
		expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
	});

	it("recovers from start failure without leaving pending start stuck", async () => {
		const user = userEvent.setup();
		getDiagnosticSummaryMock.mockResolvedValue({
			traceId: "trc_runner_error",
			turnId: "turn_runner_error",
			summary: "Trace failed at BOOT_CONN_002 after RUNNER_INIT_001.",
			errorCode: "E_PROVIDER_CONNECT_FAILED",
			lastSuccessfulDecisionId: "RUNNER_INIT_001",
			firstFailedDecisionId: "BOOT_CONN_002",
			suggestedAction: "Inspect the provider base URL, API key, and letta connect CLI stderr for the failed registration step.",
			steps: [
				{
					component: "provider-bootstrap",
					decisionId: "BOOT_CONN_002",
					status: "error",
					message: "runtime connection bootstrap failed during compatible provider registration",
					errorCode: "E_PROVIDER_CONNECT_FAILED",
				},
			],
		});
		render(<App />);

		await waitFor(() => {
			expect(sendClientEventMock).toHaveBeenCalledWith({ type: "session.list" });
		});

		await emitServerEvent({ type: "session.list", payload: { sessions: [] } });

		await user.type(screen.getByPlaceholderText("/path/to/project"), "/tmp/project");
		await user.type(
			screen.getByPlaceholderText("Describe the task you want agent to handle..."),
			"Investigate compatible bootstrap failure",
		);

		const startButton = screen.getByRole("button", { name: "Start Session" });
		await user.click(startButton);

		expect(sendClientEventMock).toHaveBeenCalledWith({
			type: "session.start",
			payload: {
				title: "",
				prompt: "Investigate compatible bootstrap failure",
				cwd: "/tmp/project",
				allowedTools: "Read,Edit,Bash",
			},
		});
		await waitFor(() => {
			expect(startButton).toBeDisabled();
		});

		await emitServerEvent({
			type: "runner.error",
			payload: { message: "Compatible bootstrap failed", traceId: "trc_runner_error" },
		});

		await waitFor(() => {
			expect(screen.getByText("Compatible bootstrap failed")).toBeInTheDocument();
		});
		expect(getDiagnosticSummaryMock).toHaveBeenCalledWith("trc_runner_error");
		expect(await screen.findByRole("button", { name: "Copy diagnostics" })).toBeInTheDocument();
		expect(
			screen.getAllByDisplayValue("Investigate compatible bootstrap failure"),
		).toHaveLength(2);
		expect(startButton).toBeEnabled();
	});

	it("falls back to latest session diagnostics when runner.error has no trace id", async () => {
		getLatestDiagnosticSummaryForSessionMock.mockResolvedValue({
			traceId: "trc_session_latest",
			sessionId: "conv_session_latest",
			summary: "Trace failed at RUNNER_INIT_002 after IPC_CONTINUE_001.",
			errorCode: "E_SESSION_CONVERSATION_ID_MISSING",
			lastSuccessfulDecisionId: "IPC_CONTINUE_001",
			firstFailedDecisionId: "RUNNER_INIT_002",
			steps: [],
		});

		render(<App />);
		await emitServerEvent({
			type: "runner.error",
			payload: { message: "Conversation id missing", sessionId: "conv_session_latest" },
		});

		await waitFor(() => {
			expect(getLatestDiagnosticSummaryForSessionMock).toHaveBeenCalledWith("conv_session_latest");
		});
		expect(await screen.findByRole("button", { name: "Copy diagnostics" })).toBeInTheDocument();
	});

	it("starts a new session from the modal and activates the session UI", async () => {
		const user = userEvent.setup();
		render(<App />);

		await waitFor(() => {
			expect(sendClientEventMock).toHaveBeenCalledWith({ type: "session.list" });
		});

		await emitServerEvent({ type: "session.list", payload: { sessions: [] } });

		await user.type(screen.getByPlaceholderText("/path/to/project"), "/tmp/project");
		await user.type(
			screen.getByPlaceholderText("Describe the task you want agent to handle..."),
			"Start a new Letta task",
		);
		await user.click(screen.getByRole("button", { name: "Start Session" }));

		await waitFor(() => {
			expect(sendClientEventMock).toHaveBeenCalledWith({
				type: "session.start",
				payload: {
					title: "",
					prompt: "Start a new Letta task",
					cwd: "/tmp/project",
					allowedTools: "Read,Edit,Bash",
				},
			});
		});

		await emitServerEvent({
			type: "session.status",
			payload: {
				sessionId: "conv-123",
				status: "running",
				title: "conv-123",
				cwd: "/tmp/project",
			},
		});

		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "Start Session" })).not.toBeInTheDocument();
		});
		await waitFor(() => {
			expect(sendClientEventMock).toHaveBeenCalledWith({
				type: "session.history",
				payload: { sessionId: "conv-123" },
			});
		});

		expect(screen.getByText("conv-123")).toBeInTheDocument();
		expect(
			screen.getByPlaceholderText("Describe what you want agent to handle..."),
		).toBeEnabled();
	});

	it("preserves a newly started desktop session when a stale empty session list arrives afterward", async () => {
		const user = userEvent.setup();
		render(<App />);

		await waitFor(() => {
			expect(sendClientEventMock).toHaveBeenCalledWith({ type: "session.list" });
		});

		await user.click(screen.getByRole("button", { name: "New Task" }));
		await user.type(screen.getByPlaceholderText("/path/to/project"), "/tmp/project");
		await user.type(
			screen.getByPlaceholderText("Describe the task you want agent to handle..."),
			"Kick off the first turn",
		);
		await user.click(screen.getByRole("button", { name: "Start Session" }));

		await waitFor(() => {
			expect(sendClientEventMock).toHaveBeenCalledWith({
				type: "session.start",
				payload: {
					title: "",
					prompt: "Kick off the first turn",
					cwd: "/tmp/project",
					allowedTools: "Read,Edit,Bash",
				},
			});
		});

		await emitServerEvent({
			type: "session.status",
			payload: {
				sessionId: "conv-race",
				status: "running",
				title: "conv-race",
				cwd: "/tmp/project",
			},
		});

		await emitServerEvent({
			type: "stream.user_prompt",
			payload: {
				sessionId: "conv-race",
				prompt: "Kick off the first turn",
			},
		});

		await emitServerEvent({ type: "session.list", payload: { sessions: [] } });

		await waitFor(() => {
			expect(useAppStore.getState().activeSessionId).toBe("conv-race");
		});
		expect(useAppStore.getState().sessions["conv-race"]).toMatchObject({
			id: "conv-race",
			status: "running",
		});
		expect(screen.queryByRole("button", { name: "Start Session" })).not.toBeInTheDocument();
	});

	it("opens the diagnostics view and renders persisted trace details", async () => {
		const user = userEvent.setup();
		listDiagnosticSummariesMock.mockResolvedValue([
			{
				traceId: "trc_diag_1",
				turnId: "turn_diag_1",
				sessionId: "conv_diag_1",
				summary: "Trace failed at BOOT_CONN_002 after RUNNER_INIT_001.",
				errorCode: "E_PROVIDER_CONNECT_FAILED",
				lastSuccessfulDecisionId: "RUNNER_INIT_001",
				firstFailedDecisionId: "BOOT_CONN_002",
				suggestedAction: "Inspect the provider base URL, API key, and letta connect CLI stderr for the failed registration step.",
				createdAt: "2026-04-09T18:00:00.000Z",
				updatedAt: "2026-04-09T18:01:00.000Z",
				stepCount: 2,
			},
		]);
		getDiagnosticSummaryMock.mockResolvedValue({
			traceId: "trc_diag_1",
			turnId: "turn_diag_1",
			sessionId: "conv_diag_1",
			summary: "Trace failed at BOOT_CONN_002 after RUNNER_INIT_001.",
			errorCode: "E_PROVIDER_CONNECT_FAILED",
			lastSuccessfulDecisionId: "RUNNER_INIT_001",
			firstFailedDecisionId: "BOOT_CONN_002",
			suggestedAction: "Inspect the provider base URL, API key, and letta connect CLI stderr for the failed registration step.",
			createdAt: "2026-04-09T18:00:00.000Z",
			updatedAt: "2026-04-09T18:01:00.000Z",
			stepCount: 2,
			steps: [
				{
					component: "runner",
					decisionId: "RUNNER_INIT_001",
					status: "ok",
					message: "runtime connection ready",
				},
				{
					component: "provider-bootstrap",
					decisionId: "BOOT_CONN_002",
					status: "error",
					message: "runtime connection bootstrap failed during compatible provider registration",
					errorCode: "E_PROVIDER_CONNECT_FAILED",
				},
			],
		});

		render(<App />);
		await waitFor(() => {
			expect(sendClientEventMock).toHaveBeenCalledWith({ type: "session.list" });
		});

		await user.click(screen.getByRole("button", { name: "Diagnostics" }));

		expect(await screen.findByRole("heading", { level: 2, name: "Trace failed at BOOT_CONN_002 after RUNNER_INIT_001." })).toBeInTheDocument();
		expect(screen.getAllByText("RUNNER_INIT_001").length).toBeGreaterThanOrEqual(2);
		expect(screen.getByRole("button", { name: "Copy diagnostics" })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Copy diagnostics" }));
		await expect(navigator.clipboard.readText()).resolves.toContain("Trace ID: trc_diag_1");
		expect(getDiagnosticSummaryMock).toHaveBeenCalledWith("trc_diag_1");
	});
});
