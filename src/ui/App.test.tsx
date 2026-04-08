// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useAppStore } from "./store/useAppStore";
import type { ServerEvent } from "./types";

vi.mock("./components/Sidebar", () => ({
	Sidebar: ({ onNewSession }: { onNewSession: () => void }) => (
		<button onClick={onNewSession} type="button">
			New Task
		</button>
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

	beforeEach(() => {
		resetAppStore();
		serverEventHandler = null;
		sendClientEventMock = vi.fn();

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
				getStaticData: vi.fn().mockResolvedValue({
					totalStorage: 512,
					cpuModel: "Apple M3",
					totalMemoryGB: 18,
					codeIsland: {
						platformSupported: true,
						available: true,
						status: "launched",
						running: true,
					},
				}),
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

	function emitServerEvent(event: ServerEvent) {
		if (!serverEventHandler) {
			throw new Error("Server event handler was not registered");
		}

		act(() => {
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

		const promptInput = await screen.findByPlaceholderText(
			"Describe what you want agent to handle...",
		);
		const sendButton = screen.getByRole("button", { name: "Send prompt" });

		expect(promptInput).toBeEnabled();
		expect(sendButton).toBeEnabled();
		expect(screen.getByText("No messages yet")).toBeInTheDocument();
	});

	it("recovers from start failure without leaving pending start stuck", async () => {
		const user = userEvent.setup();
		render(<App />);

		await waitFor(() => {
			expect(sendClientEventMock).toHaveBeenCalledWith({ type: "session.list" });
		});

		emitServerEvent({ type: "session.list", payload: { sessions: [] } });

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

		emitServerEvent({
			type: "runner.error",
			payload: { message: "Compatible bootstrap failed" },
		});

		await waitFor(() => {
			expect(screen.getByText("Compatible bootstrap failed")).toBeInTheDocument();
		});
		expect(
			screen.getAllByDisplayValue("Investigate compatible bootstrap failure"),
		).toHaveLength(2);
		expect(startButton).toBeEnabled();
	});

	it("starts a new session from the modal and activates the session UI", async () => {
		const user = userEvent.setup();
		render(<App />);

		await waitFor(() => {
			expect(sendClientEventMock).toHaveBeenCalledWith({ type: "session.list" });
		});

		emitServerEvent({ type: "session.list", payload: { sessions: [] } });

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

		emitServerEvent({
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
});
