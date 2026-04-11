import { beforeEach, describe, expect, it, vi } from "vitest";

type TestHandler = (...args: unknown[]) => unknown;
type MockedApp = {
	exit: ReturnType<typeof vi.fn>;
	quit: ReturnType<typeof vi.fn>;
};

const appHandlers = new Map<string, TestHandler[]>();
const windows: Array<{
  closed: boolean;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  emitClosed: () => void;
}> = [];

const bootstrapElectronRuntimeMock = vi.hoisted(() => vi.fn());
const startElectronRuntimeServicesMock = vi.hoisted(() => vi.fn());
const stopElectronRuntimeServicesMock = vi.hoisted(() => vi.fn());
const stopElectronDevelopmentServerMock = vi.hoisted(() => vi.fn());
const cleanupAllSessionsMock = vi.hoisted(() => vi.fn());
const pollResourcesMock = vi.hoisted(() => vi.fn());
const stopPollingMock = vi.hoisted(() => vi.fn());
const ipcMainHandleMock = vi.hoisted(() => vi.fn((key: string, handler: TestHandler) => {
	const current = appHandlers.get(key) ?? [];
	current.push(handler);
	appHandlers.set(key, current);
}));
const lettabotHostStopMock = vi.hoisted(() => vi.fn());
const saveAppConfigMock = vi.hoisted(() => vi.fn());
const createResidentCoreChannelsRuntimeBundleMock = vi.hoisted(() => vi.fn());
const recordDiagnosticEventMock = vi.hoisted(() => vi.fn());
const bindResidentCoreServiceMock = vi.hoisted(() => vi.fn());
const residentCoreBroadcastMock = vi.hoisted(() => vi.fn());
const residentCoreServiceCleanupMock = vi.hoisted(() => vi.fn());
const residentCoreSetActiveBotRuntimeGenerationMock = vi.hoisted(() => vi.fn());
const createResidentCoreServiceMock = vi.hoisted(() => vi.fn(() => ({
	handleClientEvent: vi.fn(async () => undefined),
	ingestServerEvent: vi.fn(),
	cleanupAllSessions: residentCoreServiceCleanupMock,
})));
const createResidentCoreSessionOwnerMock = vi.hoisted(() => vi.fn(() => ({
	setActiveBotRuntimeGeneration: residentCoreSetActiveBotRuntimeGenerationMock,
})));
const createResidentCoreSessionBackendMock = vi.hoisted(() => vi.fn(() => ({ warmSession: vi.fn(async () => undefined), invalidateSession: vi.fn() })));
const createResidentCoreRuntimeHostMock = vi.hoisted(() => vi.fn(() => ({})));

vi.mock("electron", () => {
	const app = {
		isPackaged: false,
		on: vi.fn((event: string, handler: TestHandler) => {
			const current = appHandlers.get(event) ?? [];
			current.push(handler);
			appHandlers.set(event, current);
			return app;
		}),
		quit: vi.fn(),
		exit: vi.fn(),
		getPath: vi.fn(() => "/tmp/letta-desktop-test"),
		setName: vi.fn(),
		setAppUserModelId: vi.fn(),
	};

	class BrowserWindow {
		static getAllWindows() {
			return windows.filter((window) => !window.closed);
		}

		closed = false;
		webContents = {
			send: vi.fn(),
		};
		loadURL = vi.fn();
		loadFile = vi.fn();
		handlers = new Map<string, TestHandler>();
		on = vi.fn((event: string, handler: TestHandler) => {
			this.handlers.set(event, handler);
			return this;
		});

		constructor() {
			windows.push(this);
		}

		emitClosed() {
			this.closed = true;
			this.handlers.get("closed")?.();
		}
	}

	return {
		app,
		BrowserWindow,
		dialog: {
			showOpenDialog: vi.fn(),
		},
		globalShortcut: {
			register: vi.fn(),
			unregisterAll: vi.fn(),
		},
		ipcMain: {
			handle: vi.fn(),
			on: vi.fn(),
		},
		Menu: {
			setApplicationMenu: vi.fn(),
		},
	};
});

vi.mock("./libs/main-runtime.js", () => ({
	bootstrapElectronRuntime: bootstrapElectronRuntimeMock,
	startElectronRuntimeServices: startElectronRuntimeServicesMock,
	stopElectronRuntimeServices: stopElectronRuntimeServicesMock,
	stopElectronDevelopmentServer: stopElectronDevelopmentServerMock,
	createResidentCoreChannelsRuntimeBundle: createResidentCoreChannelsRuntimeBundleMock,
}));

vi.mock("./ipc-handlers.js", () => ({
	handleClientEvent: vi.fn(),
	cleanupAllSessions: cleanupAllSessionsMock,
	bindResidentCoreService: bindResidentCoreServiceMock,
	residentCoreBroadcast: residentCoreBroadcastMock,
}));

vi.mock("./libs/resident-core/resident-core.js", () => ({
	createResidentCoreService: createResidentCoreServiceMock,
}));

vi.mock("./libs/resident-core/session-owner.js", () => ({
	createResidentCoreSessionOwner: createResidentCoreSessionOwnerMock,
}));

vi.mock("./libs/resident-core/resident-core-session-backend.js", () => ({
	createResidentCoreSessionBackend: createResidentCoreSessionBackendMock,
}));

vi.mock("./libs/resident-core/runtime-host.js", () => ({
	createResidentCoreRuntimeHost: createResidentCoreRuntimeHostMock,
}));

vi.mock("./test.js", () => ({
	getStaticData: vi.fn(() => ({})),
	pollResources: pollResourcesMock,
	stopPolling: stopPollingMock,
}));

vi.mock("./pathResolver.js", () => ({
	getPreloadPath: vi.fn(() => "/tmp/preload.js"),
	getUIPath: vi.fn(() => "/tmp/ui.html"),
	getIconPath: vi.fn(() => "/tmp/icon.icns"),
}));

vi.mock("./libs/config.js", () => ({
	getAppConfigState: vi.fn(() => ({ config: {} })),
	saveAppConfig: saveAppConfigMock,
	getResidentCoreLettaBotRuntimeConfig: vi.fn(() => ({
		workingDir: "/tmp/letta-desktop-test/lettabot",
		channels: {},
	})),
}));

vi.mock("./libs/bundled-letta-server.js", () => ({
	getBundledLettaServerRuntimeStatus: vi.fn(() => ({})),
}));

vi.mock("./libs/diagnostics.js", () => ({
	initializeDiagnosticsPersistence: vi.fn(),
	flushDiagnosticsPersistence: vi.fn(),
	listDiagnosticSummaries: vi.fn(() => []),
	getDiagnosticSummary: vi.fn(() => null),
	getLatestDiagnosticSummaryForSession: vi.fn(() => null),
	recordDiagnosticEvent: recordDiagnosticEventMock,
}));

vi.mock("./libs/bundled-codeisland.js", () => ({
	getCodeIslandRuntimeStatus: vi.fn(() => ({})),
}));

vi.mock("./util.js", () => ({
	ipcMainHandle: ipcMainHandleMock,
	isDev: vi.fn(() => true),
	DEV_PORT: 5173,
}));

describe("main lifecycle", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		appHandlers.clear();
		windows.splice(0, windows.length);
	});

	async function bootstrapMain(): Promise<{ app: MockedApp }> {
		await import("./main.ts");
		const { app } = await import("electron");
		return { app: app as unknown as MockedApp };
	}

	function getHandler(event: string): TestHandler {
		const handlers = appHandlers.get(event);
		if (!handlers || handlers.length === 0) {
			throw new Error(`Missing handler for ${event}`);
		}
		return handlers[0];
	}

	async function invokeIpcHandler(event: string, ...args: unknown[]): Promise<unknown> {
		const handler = getHandler(event);
		return await handler({} as never, ...args);
	}

	it("keeps the runtime alive when the last window closes", async () => {
		const { app } = await bootstrapMain();
		startElectronRuntimeServicesMock.mockReturnValue({ codeIslandMonitor: null, lettabotHost: { stop: lettabotHostStopMock } });

		getHandler("ready")();

		expect(startElectronRuntimeServicesMock).toHaveBeenCalledTimes(1);
		expect(createResidentCoreSessionBackendMock).toHaveBeenCalledWith(expect.objectContaining({
			onServerEvent: expect.any(Function),
		}));
		expect(windows).toHaveLength(1);

		const preventDefault = vi.fn();
		getHandler("window-all-closed")({ preventDefault });
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopElectronRuntimeServicesMock).not.toHaveBeenCalled();
		expect(lettabotHostStopMock).not.toHaveBeenCalled();
		expect(cleanupAllSessionsMock).not.toHaveBeenCalled();
		expect(stopElectronDevelopmentServerMock).not.toHaveBeenCalled();
		expect(app.exit).not.toHaveBeenCalled();

		windows[0].emitClosed();

		expect(stopElectronRuntimeServicesMock).not.toHaveBeenCalled();
		expect(lettabotHostStopMock).not.toHaveBeenCalled();
		expect(cleanupAllSessionsMock).not.toHaveBeenCalled();
		expect(stopElectronDevelopmentServerMock).not.toHaveBeenCalled();
		expect(app.exit).not.toHaveBeenCalled();
		expect(windows).toHaveLength(1);
		expect(windows[0].closed).toBe(true);
	});

	it("rebuilds the main window on activate after all windows close", async () => {
		await bootstrapMain();
		startElectronRuntimeServicesMock.mockReturnValue({ codeIslandMonitor: null, lettabotHost: { stop: lettabotHostStopMock } });

		getHandler("ready")();
		expect(windows).toHaveLength(1);

		windows[0].emitClosed();
		expect(windows.filter((window) => !window.closed)).toHaveLength(0);

		getHandler("activate")();

		expect(windows.filter((window) => !window.closed)).toHaveLength(1);
		expect(pollResourcesMock).toHaveBeenCalledTimes(2);
		expect(windows[1].loadURL).toHaveBeenCalledWith("http://localhost:5173");
	});

	it("cleans up runtime only on explicit quit", async () => {
		const { app } = await bootstrapMain();
		startElectronRuntimeServicesMock.mockReturnValue({ codeIslandMonitor: { stop: vi.fn() }, lettabotHost: { stop: lettabotHostStopMock } });

		getHandler("ready")();
		const preventDefault = vi.fn();
		getHandler("before-quit")({ preventDefault });
		expect(preventDefault).toHaveBeenCalledTimes(1);
		await new Promise<void>((resolve) => setImmediate(resolve));

		expect(stopElectronRuntimeServicesMock).toHaveBeenCalledTimes(1);
		expect(stopElectronRuntimeServicesMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ stop: lettabotHostStopMock }),
		);
		expect(cleanupAllSessionsMock).toHaveBeenCalledTimes(1);
		expect(stopElectronDevelopmentServerMock).toHaveBeenCalledTimes(1);
		expect(app.exit).toHaveBeenCalledWith(0);
	});

	it("rebuilds the channels runtime after saving app config", async () => {
		await bootstrapMain();
		createResidentCoreSessionBackendMock.mockReturnValue({
			warmSession: vi.fn(async () => undefined),
			invalidateSession: vi.fn(),
			getSession: vi.fn(),
			ensureSessionForKey: vi.fn(),
			persistSessionState: vi.fn(),
			runSession: vi.fn(),
			syncTodoToolCall: vi.fn(),
		});
		const nextHostStartMock = vi.fn(async () => undefined);
		const nextHostStopMock = vi.fn();
		const nextBackend = {
			warmSession: vi.fn(async () => undefined),
			invalidateSession: vi.fn(),
			getSession: vi.fn(),
			ensureSessionForKey: vi.fn(),
			persistSessionState: vi.fn(),
			runSession: vi.fn(),
			syncTodoToolCall: vi.fn(),
		};
		createResidentCoreChannelsRuntimeBundleMock.mockReturnValue({
			backend: nextBackend,
			lettabotHost: {
				start: nextHostStartMock,
				stop: nextHostStopMock,
				getBot: vi.fn(),
				getBackend: vi.fn(),
			},
			runtimeConfig: {
				workingDir: "/tmp/letta-desktop-test/lettabot-next",
				channels: {
					telegram: {
						token: "next-token",
						dmPolicy: "pairing",
						streaming: false,
						workingDir: "/tmp/letta-desktop-test/lettabot-next",
					},
				},
			},
		});
		saveAppConfigMock.mockReturnValue({
			mode: "packaged",
			source: "packaged-config",
			path: "/tmp/letta-desktop-test/config.json",
			config: {
				connectionType: "letta-server",
				LETTA_BASE_URL: "https://api.letta.com",
				residentCore: {
					telegram: {
						token: "next-token",
						dmPolicy: "pairing",
						streaming: false,
						workingDir: "/tmp/letta-desktop-test/lettabot-next",
					},
				},
			},
			canEdit: true,
			requiresOnboarding: false,
		});
		startElectronRuntimeServicesMock.mockReturnValue({
			codeIslandMonitor: { stop: vi.fn() },
			lettabotHost: { stop: lettabotHostStopMock },
		});

		getHandler("ready")();

		await invokeIpcHandler("save-app-config", {
			connectionType: "letta-server",
			LETTA_BASE_URL: "https://api.letta.com",
			residentCore: {
				telegram: {
					token: "next-token",
					dmPolicy: "pairing",
					streaming: false,
					workingDir: "/tmp/letta-desktop-test/lettabot-next",
				},
			},
		});

		expect(saveAppConfigMock).toHaveBeenCalledTimes(1);
		expect(createResidentCoreSessionBackendMock).toHaveBeenCalledWith(expect.objectContaining({
			onServerEvent: expect.any(Function),
			runtimeGeneration: 1,
		}));
		expect(createResidentCoreChannelsRuntimeBundleMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(Function),
			2,
		);
		expect(lettabotHostStopMock).toHaveBeenCalledTimes(1);
		expect(residentCoreServiceCleanupMock).toHaveBeenCalledTimes(1);
		expect(lettabotHostStopMock.mock.invocationCallOrder[0]).toBeLessThan(residentCoreServiceCleanupMock.mock.invocationCallOrder[0]);
		expect(residentCoreServiceCleanupMock.mock.invocationCallOrder[0]).toBeLessThan(nextHostStartMock.mock.invocationCallOrder[0]);
		expect(createResidentCoreChannelsRuntimeBundleMock).toHaveBeenCalledTimes(1);
		expect(nextHostStartMock).toHaveBeenCalledTimes(1);
		expect(nextHostStopMock).not.toHaveBeenCalled();
		expect(recordDiagnosticEventMock).toHaveBeenCalledWith(expect.objectContaining({
			decision_id: "TG_RUNTIME_RELOAD_003",
		}));
	});

	it("serializes concurrent save-app-config reloads through a shared reload promise", async () => {
		await bootstrapMain();
		createResidentCoreSessionBackendMock.mockReturnValue({
			warmSession: vi.fn(async () => undefined),
			invalidateSession: vi.fn(),
			getSession: vi.fn(),
			ensureSessionForKey: vi.fn(),
			persistSessionState: vi.fn(),
			runSession: vi.fn(),
			syncTodoToolCall: vi.fn(),
		});
		let resolveNextHostStart: (() => void) | null = null;
		const nextHostStartPromise = new Promise<void>((resolve) => {
			resolveNextHostStart = resolve;
		});
		const nextHostStartMock = vi.fn(() => nextHostStartPromise);
		const nextHostStopMock = vi.fn();
		const nextState = {
			mode: "packaged",
			source: "packaged-config",
			path: "/tmp/letta-desktop-test/config.json",
			config: {
				connectionType: "letta-server",
				LETTA_BASE_URL: "https://api.letta.com",
				residentCore: {
					telegram: {
						token: "next-token",
						dmPolicy: "pairing",
						streaming: false,
						workingDir: "/tmp/letta-desktop-test/lettabot-next",
					},
				},
			},
			canEdit: true,
			requiresOnboarding: false,
		};
		createResidentCoreChannelsRuntimeBundleMock.mockReturnValue({
			backend: {
				warmSession: vi.fn(async () => undefined),
				invalidateSession: vi.fn(),
				getSession: vi.fn(),
				ensureSessionForKey: vi.fn(),
				persistSessionState: vi.fn(),
				runSession: vi.fn(),
				syncTodoToolCall: vi.fn(),
			},
			lettabotHost: {
				start: nextHostStartMock,
				stop: nextHostStopMock,
				getBot: vi.fn(),
				getBackend: vi.fn(),
			},
			runtimeConfig: {
				workingDir: "/tmp/letta-desktop-test/lettabot-next",
				channels: {
					telegram: {
						token: "next-token",
						dmPolicy: "pairing",
						streaming: false,
						workingDir: "/tmp/letta-desktop-test/lettabot-next",
					},
				},
			},
		});
		saveAppConfigMock.mockReturnValue(nextState);
		startElectronRuntimeServicesMock.mockReturnValue({
			codeIslandMonitor: { stop: vi.fn() },
			lettabotHost: { stop: lettabotHostStopMock },
		});

		getHandler("ready")();

		const firstReload = invokeIpcHandler("save-app-config", {
			connectionType: "letta-server",
			LETTA_BASE_URL: "https://api.letta.com",
			residentCore: {
				telegram: {
					token: "next-token",
					dmPolicy: "pairing",
					streaming: false,
					workingDir: "/tmp/letta-desktop-test/lettabot-next",
				},
			},
		});
		const secondReload = invokeIpcHandler("save-app-config", {
			connectionType: "letta-server",
			LETTA_BASE_URL: "https://api.letta.com",
			residentCore: {
				telegram: {
					token: "next-token",
					dmPolicy: "pairing",
					streaming: false,
					workingDir: "/tmp/letta-desktop-test/lettabot-next",
				},
			},
		});

		expect(saveAppConfigMock).toHaveBeenCalledTimes(2);
		expect(createResidentCoreChannelsRuntimeBundleMock).toHaveBeenCalledTimes(1);
		expect(createResidentCoreChannelsRuntimeBundleMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(Function),
			2,
		);

		await new Promise<void>((resolve) => setImmediate(resolve));

		expect(nextHostStartMock).toHaveBeenCalledTimes(1);
		expect(lettabotHostStopMock).toHaveBeenCalledTimes(1);
		expect(residentCoreServiceCleanupMock).toHaveBeenCalledTimes(1);
		expect(lettabotHostStopMock.mock.invocationCallOrder[0]).toBeLessThan(residentCoreServiceCleanupMock.mock.invocationCallOrder[0]);
		expect(residentCoreServiceCleanupMock.mock.invocationCallOrder[0]).toBeLessThan(nextHostStartMock.mock.invocationCallOrder[0]);

		resolveNextHostStart?.();

		const [firstResult, secondResult] = await Promise.all([firstReload, secondReload]);

		expect(firstResult).toBe(nextState);
		expect(secondResult).toBe(nextState);
		expect(firstResult).toBe(secondResult);
		expect(lettabotHostStopMock).toHaveBeenCalledTimes(1);
		expect(residentCoreServiceCleanupMock).toHaveBeenCalledTimes(1);
		expect(lettabotHostStopMock.mock.invocationCallOrder[0]).toBeLessThan(residentCoreServiceCleanupMock.mock.invocationCallOrder[0]);
		expect(residentCoreServiceCleanupMock.mock.invocationCallOrder[0]).toBeLessThan(nextHostStartMock.mock.invocationCallOrder[0]);
		expect(nextHostStopMock).not.toHaveBeenCalled();
	});

	it("returns saved config and rolls back to the previous host when channels reload fails", async () => {
		await bootstrapMain();
		createResidentCoreSessionBackendMock.mockReturnValue({
			warmSession: vi.fn(async () => undefined),
			invalidateSession: vi.fn(),
			getSession: vi.fn(),
			ensureSessionForKey: vi.fn(),
			persistSessionState: vi.fn(),
			runSession: vi.fn(),
			syncTodoToolCall: vi.fn(),
		});
		const failingHostStartMock = vi.fn(async () => {
			throw new Error("telegram restart failed");
		});
		const nextHostStopMock = vi.fn(async () => undefined);
		const previousHostStartMock = vi.fn(async () => undefined);
		createResidentCoreChannelsRuntimeBundleMock.mockReturnValue({
			backend: {
				warmSession: vi.fn(async () => undefined),
				invalidateSession: vi.fn(),
				getSession: vi.fn(),
				ensureSessionForKey: vi.fn(),
				persistSessionState: vi.fn(),
				runSession: vi.fn(),
				syncTodoToolCall: vi.fn(),
			},
			lettabotHost: {
				start: failingHostStartMock,
				stop: nextHostStopMock,
				getBot: vi.fn(),
				getBackend: vi.fn(),
			},
			runtimeConfig: {
				workingDir: "/tmp/letta-desktop-test/lettabot-next",
				channels: {
					telegram: {
						token: "next-token",
						dmPolicy: "pairing",
						streaming: false,
						workingDir: "/tmp/letta-desktop-test/lettabot-next",
					},
				},
			},
		});
		const nextState = {
			mode: "packaged",
			source: "packaged-config",
			path: "/tmp/letta-desktop-test/config.json",
			config: {
				connectionType: "letta-server",
				LETTA_BASE_URL: "https://api.letta.com",
				residentCore: {
					telegram: {
						token: "next-token",
						dmPolicy: "pairing",
						streaming: false,
						workingDir: "/tmp/letta-desktop-test/lettabot-next",
					},
				},
			},
			canEdit: true,
			requiresOnboarding: false,
		};
		saveAppConfigMock.mockReturnValue(nextState);
		startElectronRuntimeServicesMock.mockReturnValue({
			codeIslandMonitor: { stop: vi.fn() },
			lettabotHost: { start: previousHostStartMock, stop: lettabotHostStopMock },
		});

		getHandler("ready")();

		await expect(invokeIpcHandler("save-app-config", {
			connectionType: "letta-server",
			LETTA_BASE_URL: "https://api.letta.com",
			residentCore: {
				telegram: {
					token: "next-token",
					dmPolicy: "pairing",
					streaming: false,
					workingDir: "/tmp/letta-desktop-test/lettabot-next",
				},
			},
		})).resolves.toBe(nextState);

		expect(saveAppConfigMock).toHaveBeenCalledTimes(1);
		expect(createResidentCoreSessionBackendMock).toHaveBeenCalledWith(expect.objectContaining({
			onServerEvent: expect.any(Function),
			runtimeGeneration: 1,
		}));
		expect(createResidentCoreChannelsRuntimeBundleMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(Function),
			2,
		);
		expect(lettabotHostStopMock).toHaveBeenCalledTimes(1);
		expect(residentCoreServiceCleanupMock).toHaveBeenCalledTimes(1);
		expect(lettabotHostStopMock.mock.invocationCallOrder[0]).toBeLessThan(residentCoreServiceCleanupMock.mock.invocationCallOrder[0]);
		expect(residentCoreServiceCleanupMock.mock.invocationCallOrder[0]).toBeLessThan(failingHostStartMock.mock.invocationCallOrder[0]);
		expect(failingHostStartMock).toHaveBeenCalledTimes(1);
		expect(nextHostStopMock).toHaveBeenCalledTimes(1);
		expect(previousHostStartMock).toHaveBeenCalledTimes(1);
		expect(residentCoreBroadcastMock).toHaveBeenCalledWith(expect.objectContaining({
			type: "runner.error",
			payload: expect.objectContaining({
				message: expect.stringContaining("Settings saved, but channels runtime reload failed"),
			}),
		}));
		expect(recordDiagnosticEventMock).toHaveBeenCalledWith(expect.objectContaining({
			decision_id: "TG_RUNTIME_RELOAD_004",
			error_code: "E_TELEGRAM_RUNTIME_RELOAD_FAILED",
		}));
	});

	it("returns saved config and marks channels offline when reload and rollback both fail", async () => {
		await bootstrapMain();
		createResidentCoreSessionBackendMock.mockReturnValue({
			warmSession: vi.fn(async () => undefined),
			invalidateSession: vi.fn(),
			getSession: vi.fn(),
			ensureSessionForKey: vi.fn(),
			persistSessionState: vi.fn(),
			runSession: vi.fn(),
			syncTodoToolCall: vi.fn(),
		});
		const failingHostStartMock = vi.fn(async () => {
			throw new Error("telegram restart failed");
		});
		const nextHostStopMock = vi.fn(async () => undefined);
		const previousHostStartMock = vi.fn(async () => {
			throw new Error("previous telegram restart failed");
		});
		createResidentCoreChannelsRuntimeBundleMock.mockReturnValue({
			backend: {
				warmSession: vi.fn(async () => undefined),
				invalidateSession: vi.fn(),
				getSession: vi.fn(),
				ensureSessionForKey: vi.fn(),
				persistSessionState: vi.fn(),
				runSession: vi.fn(),
				syncTodoToolCall: vi.fn(),
			},
			lettabotHost: {
				start: failingHostStartMock,
				stop: nextHostStopMock,
				getBot: vi.fn(),
				getBackend: vi.fn(),
			},
			runtimeConfig: {
				workingDir: "/tmp/letta-desktop-test/lettabot-next",
				channels: {
					telegram: {
						token: "next-token",
						dmPolicy: "pairing",
						streaming: false,
						workingDir: "/tmp/letta-desktop-test/lettabot-next",
					},
				},
			},
		});
		const nextState = {
			mode: "packaged",
			source: "packaged-config",
			path: "/tmp/letta-desktop-test/config.json",
			config: {
				connectionType: "letta-server",
				LETTA_BASE_URL: "https://api.letta.com",
				residentCore: {
					telegram: {
						token: "next-token",
						dmPolicy: "pairing",
						streaming: false,
						workingDir: "/tmp/letta-desktop-test/lettabot-next",
					},
				},
			},
			canEdit: true,
			requiresOnboarding: false,
		};
		saveAppConfigMock.mockReturnValue(nextState);
		startElectronRuntimeServicesMock.mockReturnValue({
			codeIslandMonitor: { stop: vi.fn() },
			lettabotHost: { start: previousHostStartMock, stop: lettabotHostStopMock },
		});

		getHandler("ready")();

		await expect(invokeIpcHandler("save-app-config", {
			connectionType: "letta-server",
			LETTA_BASE_URL: "https://api.letta.com",
			residentCore: {
				telegram: {
					token: "next-token",
					dmPolicy: "pairing",
					streaming: false,
					workingDir: "/tmp/letta-desktop-test/lettabot-next",
				},
			},
		})).resolves.toBe(nextState);

		expect(lettabotHostStopMock).toHaveBeenCalledTimes(1);
		expect(residentCoreServiceCleanupMock).toHaveBeenCalledTimes(1);
		expect(failingHostStartMock).toHaveBeenCalledTimes(1);
		expect(nextHostStopMock).toHaveBeenCalledTimes(1);
		expect(previousHostStartMock).toHaveBeenCalledTimes(1);
		expect(residentCoreBroadcastMock).toHaveBeenCalledWith(expect.objectContaining({
			type: "runner.error",
			payload: expect.objectContaining({
				message: expect.stringContaining("Settings saved, but channels runtime reload failed"),
			}),
		}));
	});
});
