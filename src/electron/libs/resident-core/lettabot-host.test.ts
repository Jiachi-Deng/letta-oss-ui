import { beforeEach, describe, expect, it, vi } from "vitest";

const createResidentCoreSessionBackendMock = vi.hoisted(() => vi.fn());
const createChannelsForAgentMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp/letta-desktop-test"),
	},
}));

vi.mock("./resident-core-session-backend.js", () => ({
	createResidentCoreSessionBackend: createResidentCoreSessionBackendMock,
}));

vi.mock("lettabot/channels/factory.js", () => ({
	createChannelsForAgent: createChannelsForAgentMock,
}));

describe("ResidentCoreLettaBotHost", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("starts Telegram channels against the Resident Core backend when Telegram is configured", async () => {
		const backend = {
			warmSession: vi.fn(async () => undefined),
			invalidateSession: vi.fn(),
			getSession: vi.fn(),
			ensureSessionForKey: vi.fn(),
			persistSessionState: vi.fn(),
			runSession: vi.fn(),
			syncTodoToolCall: vi.fn(),
		};
		const adapter = {
			id: "telegram",
			name: "Telegram",
			start: vi.fn(async () => undefined),
			stop: vi.fn(async () => undefined),
			isRunning: vi.fn(() => true),
			sendMessage: vi.fn(async () => ({ messageId: "msg-1" })),
			editMessage: vi.fn(async () => undefined),
			sendTypingIndicator: vi.fn(async () => undefined),
			getFormatterHints: vi.fn(() => ({})),
		};
		const bot = {
			registerChannel: vi.fn(),
			start: vi.fn(async () => undefined),
			stop: vi.fn(async () => undefined),
			warmSession: vi.fn(async () => undefined),
		};

		createResidentCoreSessionBackendMock.mockReturnValue(backend);
		createChannelsForAgentMock.mockReturnValue([adapter]);

		const { createResidentCoreLettaBotHost } = await import("./lettabot-host.js");
		const host = createResidentCoreLettaBotHost({
			config: {
				workingDir: "/tmp/letta-desktop-test/lettabot",
				allowedTools: [],
				conversationMode: "shared",
				reuseSession: true,
				agentName: "ResidentCoreLettaBot",
			},
			channels: {
				telegram: {
					token: "telegram-token",
					dmPolicy: "open",
					streaming: true,
					workingDir: "/tmp/letta-desktop-test/lettabot",
				},
			},
			createBot: vi.fn(() => bot) as never,
		});

		await host.start();

		expect(createResidentCoreSessionBackendMock).toHaveBeenCalledTimes(1);
		expect(createChannelsForAgentMock).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "ResidentCoreLettaBot",
				channels: {
					telegram: expect.objectContaining({
						token: "telegram-token",
						dmPolicy: "open",
						streaming: true,
					}),
				},
			}),
			"/tmp/letta-desktop-test/lettabot",
			expect.any(Number),
		);
		expect(bot.registerChannel).toHaveBeenCalledWith(adapter);
		expect(bot.start).toHaveBeenCalledTimes(1);
		expect(host.getBackend()).toBe(backend);
		expect(host.getBot()).toBe(bot);
	});

	it("no-ops cleanly when Telegram is not configured", async () => {
		const backend = {
			warmSession: vi.fn(async () => undefined),
			invalidateSession: vi.fn(),
			getSession: vi.fn(),
			ensureSessionForKey: vi.fn(),
			persistSessionState: vi.fn(),
			runSession: vi.fn(),
			syncTodoToolCall: vi.fn(),
		};
		const createBot = vi.fn();

		createResidentCoreSessionBackendMock.mockReturnValue(backend);

		const { createResidentCoreLettaBotHost } = await import("./lettabot-host.js");
		const host = createResidentCoreLettaBotHost({
			config: {
				workingDir: "/tmp/letta-desktop-test/lettabot",
				allowedTools: [],
				conversationMode: "shared",
				reuseSession: true,
				agentName: "ResidentCoreLettaBot",
			},
			channels: {
				telegram: null,
			},
			createBot: createBot as never,
		});

		await host.start();

		expect(createResidentCoreSessionBackendMock).not.toHaveBeenCalled();
		expect(createChannelsForAgentMock).not.toHaveBeenCalled();
		expect(createBot).not.toHaveBeenCalled();
		expect(host.getBackend()).toBeNull();
		expect(host.getBot()).toBeNull();
	});
});
