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
		expect(ownerMock.invalidateBotSession).toHaveBeenCalledWith("conv-test");
		expect(createSessionMock).not.toHaveBeenCalled();
		expect(resumeSessionMock).not.toHaveBeenCalled();
	});
});
