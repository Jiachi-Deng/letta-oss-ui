import { beforeEach, describe, expect, it } from "vitest";
import type { StreamMessage } from "../types";
import { useAppStore } from "./useAppStore";

function resetStore(): void {
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

function assistantMessage(uuid: string, content: string): StreamMessage {
	return { type: "assistant", uuid, content } as StreamMessage;
}

function reasoningMessage(uuid: string, content: string): StreamMessage {
	return { type: "reasoning", uuid, content } as StreamMessage;
}

function userPromptMessage(prompt: string): StreamMessage {
	return { type: "user_prompt", prompt } as StreamMessage;
}

type SessionSeed = {
	title?: string;
	status?: "idle" | "running" | "completed" | "error";
	cwd?: string;
	messages?: StreamMessage[];
	permissionRequests?: Array<{ toolUseId: string; toolName: string; input: unknown }>;
	hydrated?: boolean;
	createdAt?: number;
	updatedAt?: number;
};

function makeSession(
	id: string,
	overrides: SessionSeed = {},
) {
	return {
		id,
		title: id,
		status: "idle" as const,
		cwd: undefined,
		messages: [],
		permissionRequests: [],
		hydrated: true,
		...overrides,
	};
}

describe("useAppStore hot path semantics", () => {
	beforeEach(() => {
		resetStore();
	});

	it("accumulates assistant and reasoning deltas by uuid", () => {
		const event = useAppStore.getState().handleServerEvent;

		event({
			type: "stream.message",
			payload: {
				sessionId: "conv-1",
				message: assistantMessage("msg-1", "Hello"),
			},
		});
		event({
			type: "stream.message",
			payload: {
				sessionId: "conv-1",
				message: assistantMessage("msg-1", " world"),
			},
		});
		event({
			type: "stream.message",
			payload: {
				sessionId: "conv-1",
				message: reasoningMessage("msg-2", "Step 1"),
			},
		});
		event({
			type: "stream.message",
			payload: {
				sessionId: "conv-1",
				message: reasoningMessage("msg-2", " + Step 2"),
			},
		});

		expect(useAppStore.getState().sessions["conv-1"]?.messages).toEqual([
			assistantMessage("msg-1", "Hello world"),
			reasoningMessage("msg-2", "Step 1 + Step 2"),
		]);
	});

	it("preserves active, running, and locally populated sessions on session.list", () => {
		useAppStore.setState({
			activeSessionId: "active",
			sessions: {
				active: makeSession("active"),
				running: makeSession("running", { status: "running" }),
				"local-messages": makeSession("local-messages", {
					messages: [userPromptMessage("draft")],
				}),
				"local-permission": makeSession("local-permission", {
					permissionRequests: [
						{ toolUseId: "tool-1", toolName: "filesystem.read", input: {} },
					],
				}),
				orphan: makeSession("orphan"),
			},
		});

		const event = useAppStore.getState().handleServerEvent;
		event({
			type: "session.list",
			payload: {
				sessions: [
					{
						id: "remote",
						title: "Remote",
						status: "completed",
						createdAt: 10,
						updatedAt: 20,
					},
				],
			},
		});

		const state = useAppStore.getState();
		expect(Object.keys(state.sessions).sort()).toEqual([
			"active",
			"local-messages",
			"local-permission",
			"remote",
			"running",
		]);
		expect(state.sessions.orphan).toBeUndefined();
		expect(state.activeSessionId).toBe("active");
		expect(state.sessionsLoaded).toBe(true);
		expect(state.showStartModal).toBe(false);
	});

	it("merges history with existing local messages in order", () => {
		useAppStore.setState({
			sessions: {
				"conv-1": makeSession("conv-1", {
					status: "running",
					messages: [
						assistantMessage("msg-1", "local assistant"),
						reasoningMessage("msg-2", "local reasoning"),
						userPromptMessage("draft-1"),
						userPromptMessage("draft-2"),
					],
					hydrated: false,
				}),
			},
		});

		const event = useAppStore.getState().handleServerEvent;
		event({
			type: "session.history",
			payload: {
				sessionId: "conv-1",
				status: "running",
				messages: [
					assistantMessage("msg-1", "history assistant"),
					reasoningMessage("msg-2", "history reasoning"),
				],
			},
		});

		expect(useAppStore.getState().sessions["conv-1"]).toMatchObject({
			status: "running",
			hydrated: true,
			messages: [
				assistantMessage("msg-1", "history assistant"),
				reasoningMessage("msg-2", "history reasoning"),
				userPromptMessage("draft-1"),
				userPromptMessage("draft-2"),
			],
		});
	});

	it("accumulates permission requests in arrival order", () => {
		const event = useAppStore.getState().handleServerEvent;

		event({
			type: "permission.request",
			payload: {
				sessionId: "conv-1",
				toolUseId: "tool-1",
				toolName: "filesystem.read",
				input: { path: "/tmp/a" },
			},
		});
		event({
			type: "permission.request",
			payload: {
				sessionId: "conv-1",
				toolUseId: "tool-2",
				toolName: "filesystem.write",
				input: { path: "/tmp/b" },
			},
		});

		expect(useAppStore.getState().sessions["conv-1"]?.permissionRequests).toEqual([
			{ toolUseId: "tool-1", toolName: "filesystem.read", input: { path: "/tmp/a" } },
			{ toolUseId: "tool-2", toolName: "filesystem.write", input: { path: "/tmp/b" } },
		]);
	});
});
