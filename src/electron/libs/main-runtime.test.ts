import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDiagnosticsForTests } from "./diagnostics.js";

const createResidentCoreLettaBotHostMock = vi.hoisted(() => vi.fn());
const createResidentCoreSessionBackendMock = vi.hoisted(() => vi.fn());
const ensureBundledLettaServerStartedMock = vi.hoisted(() => vi.fn(async () => ({ status: "unsupported" as const })));
const ensureCodeIslandStartedMock = vi.hoisted(() => vi.fn(() => ({ status: "unsupported" as const })));
const startCodeIslandMonitorMock = vi.hoisted(() => vi.fn(() => ({ stop: vi.fn() })));
const getResidentCoreLettaBotRuntimeConfigMock = vi.hoisted(() => vi.fn(() => ({
	workingDir: "/tmp/letta-desktop-test/lettabot",
	channels: {
		telegram: {
			token: "telegram-token",
			dmPolicy: "open",
			streaming: true,
			workingDir: "/tmp/letta-desktop-test/lettabot",
		},
	},
})));

vi.mock("electron", () => ({
	app: {
		isPackaged: false,
		setName: vi.fn(),
		setAppUserModelId: vi.fn(),
		getPath: vi.fn(() => "/tmp/letta-desktop-test"),
	},
}));

vi.mock("./bundled-letta-server.js", () => ({
	configureBundledLettaServerEnv: vi.fn(),
	ensureBundledLettaServerStarted: ensureBundledLettaServerStartedMock,
	stopBundledLettaServer: vi.fn(),
}));

vi.mock("./resident-core/lettabot-host.js", () => ({
	createResidentCoreLettaBotHost: createResidentCoreLettaBotHostMock,
}));

vi.mock("./resident-core/resident-core-session-backend.js", () => ({
	createResidentCoreSessionBackend: createResidentCoreSessionBackendMock,
}));

vi.mock("./bundled-codeisland.js", () => ({
	ensureCodeIslandStarted: ensureCodeIslandStartedMock,
	startCodeIslandMonitor: startCodeIslandMonitorMock,
}));

vi.mock("./config.js", () => ({
	initializeAppConfig: vi.fn(),
	getResidentCoreLettaBotRuntimeConfig: getResidentCoreLettaBotRuntimeConfigMock,
}));

describe("main-runtime resident core wiring", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		resetDiagnosticsForTests();
	});

	it("passes channels runtime config into the Resident Core LettaBot host", async () => {
		const backend = {
			warmSession: vi.fn(async () => undefined),
			invalidateSession: vi.fn(),
			getSession: vi.fn(),
			ensureSessionForKey: vi.fn(),
			persistSessionState: vi.fn(),
			runSession: vi.fn(),
			syncTodoToolCall: vi.fn(),
		};
		const host = {
			start: vi.fn(async () => undefined),
			stop: vi.fn(),
			getBot: vi.fn(),
			getBackend: vi.fn(),
		};
		createResidentCoreLettaBotHostMock.mockReturnValue(host);

		const { startElectronRuntimeServices } = await import("./main-runtime.js");
		startElectronRuntimeServices(backend as never);

		expect(getResidentCoreLettaBotRuntimeConfigMock).toHaveBeenCalledTimes(1);
		expect(createResidentCoreLettaBotHostMock).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					workingDir: "/tmp/letta-desktop-test/lettabot",
					conversationMode: "shared",
					reuseSession: true,
				}),
				channels: expect.objectContaining({
					telegram: expect.objectContaining({
						token: "telegram-token",
						dmPolicy: "open",
						streaming: true,
					}),
				}),
				backend,
			}),
		);
		expect(host.start).toHaveBeenCalledTimes(1);
	});

	it("threads a server event sink through Resident Core channels runtime bundles", async () => {
		const backend = {
			warmSession: vi.fn(async () => undefined),
			invalidateSession: vi.fn(),
			getSession: vi.fn(),
			ensureSessionForKey: vi.fn(),
			persistSessionState: vi.fn(),
			runSession: vi.fn(),
			syncTodoToolCall: vi.fn(),
		};
		const host = {
			start: vi.fn(async () => undefined),
			stop: vi.fn(),
			getBot: vi.fn(),
			getBackend: vi.fn(),
		};
		const onServerEvent = vi.fn();
		createResidentCoreSessionBackendMock.mockReturnValue(backend);
		createResidentCoreLettaBotHostMock.mockReturnValue(host);

		const { createResidentCoreChannelsRuntimeBundle } = await import("./main-runtime.js");
		const bundle = createResidentCoreChannelsRuntimeBundle({} as never, onServerEvent);

		expect(createResidentCoreSessionBackendMock).toHaveBeenCalledWith(expect.objectContaining({
			onServerEvent,
			runtimeGeneration: undefined,
		}));
		expect(createResidentCoreLettaBotHostMock).toHaveBeenCalledWith(expect.objectContaining({
			backend,
		}));
		expect(bundle.backend).toBe(backend);
		expect(bundle.lettabotHost).toBe(host);
	});

	it("threads the runtime generation through Resident Core channels runtime bundles", async () => {
		const backend = {
			warmSession: vi.fn(async () => undefined),
			invalidateSession: vi.fn(),
			getSession: vi.fn(),
			ensureSessionForKey: vi.fn(),
			persistSessionState: vi.fn(),
			runSession: vi.fn(),
			syncTodoToolCall: vi.fn(),
		};
		const host = {
			start: vi.fn(async () => undefined),
			stop: vi.fn(),
			getBot: vi.fn(),
			getBackend: vi.fn(),
		};
		createResidentCoreSessionBackendMock.mockReturnValue(backend);
		createResidentCoreLettaBotHostMock.mockReturnValue(host);

		const { createResidentCoreChannelsRuntimeBundle } = await import("./main-runtime.js");
		createResidentCoreChannelsRuntimeBundle({} as never, vi.fn(), 3);

		expect(createResidentCoreSessionBackendMock).toHaveBeenCalledWith(expect.objectContaining({
			runtimeGeneration: 3,
		}));
	});

	it("no-ops channels startup when the runtime config is absent", async () => {
		getResidentCoreLettaBotRuntimeConfigMock.mockReturnValue({
			workingDir: "/tmp/letta-desktop-test/lettabot",
			channels: {},
		});
		const host = {
			start: vi.fn(async () => undefined),
			stop: vi.fn(),
			getBot: vi.fn(),
			getBackend: vi.fn(),
		};
		createResidentCoreLettaBotHostMock.mockReturnValue(host);

		const { startElectronRuntimeServices } = await import("./main-runtime.js");
		startElectronRuntimeServices({ warmSession: vi.fn(), invalidateSession: vi.fn() } as never);

		expect(createResidentCoreLettaBotHostMock).toHaveBeenCalledWith(
			expect.objectContaining({
				channels: {},
			}),
		);
		expect(host.start).toHaveBeenCalledTimes(1);
	});

	it("records a diagnostic failure when channels runtime startup rejects", async () => {
		const host = {
			start: vi.fn(async () => {
				throw new Error("telegram host start failed");
			}),
			stop: vi.fn(),
			getBot: vi.fn(),
			getBackend: vi.fn(),
		};
		createResidentCoreLettaBotHostMock.mockReturnValue(host);

		const { startElectronRuntimeServices } = await import("./main-runtime.js");
		startElectronRuntimeServices({ warmSession: vi.fn(), invalidateSession: vi.fn() } as never);

		await new Promise((resolve) => setTimeout(resolve, 0));
		const summaries = (await import("./diagnostics.js")).listDiagnosticSummaries();
		expect(summaries.some((summary) =>
			summary.firstFailedDecisionId === "TG_RUNTIME_START_003"
				&& summary.errorCode === "E_TELEGRAM_RUNTIME_START_FAILED"
		)).toBe(true);
	});
});
