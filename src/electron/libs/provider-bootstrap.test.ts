import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const existsSyncMock = vi.hoisted(() => vi.fn<(path: string) => boolean>());
const spawnMock = vi.hoisted(() => vi.fn());
const electronAppState = vi.hoisted(() => ({ isPackaged: false }));

vi.mock("node:fs", () => ({
	existsSync: existsSyncMock,
}));

vi.mock("node:child_process", () => ({
	spawn: spawnMock,
}));

vi.mock("electron", () => ({
	app: electronAppState,
}));

function createChildProcess(exitCode = 0) {
	const child = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
	};

	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();

	queueMicrotask(() => {
		child.emit("close", exitCode);
	});

	return child;
}

describe("provider bootstrap", () => {
	const originalEnv = { ...process.env };
	const originalResourcesPath = process.resourcesPath;

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		electronAppState.isPackaged = false;
		Object.defineProperty(process, "resourcesPath", {
			value: "/Applications/Letta.app/Contents/Resources",
			configurable: true,
		});
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		Object.defineProperty(process, "resourcesPath", {
			value: originalResourcesPath,
			configurable: true,
		});
	});

	it("prefers the unpacked CLI path when packaged", async () => {
		electronAppState.isPackaged = true;
		const unpackedPath =
			"/Applications/Letta.app/Contents/Resources/app.asar.unpacked/node_modules/@letta-ai/letta-code/letta.js";

		existsSyncMock.mockImplementation((candidate) => candidate === unpackedPath);

		const { resolveLettaCliPath } = await import("./provider-bootstrap.ts");

		expect(resolveLettaCliPath()).toBe(unpackedPath);
	});

	it("connects minimax providers with base-url passthrough in compatible mode", async () => {
		process.env.LETTA_CLI_PATH = "/tmp/letta.js";
		process.env.LETTA_LOCAL_SERVER_URL = "http://127.0.0.1:8283/";
		existsSyncMock.mockImplementation((candidate) => candidate === "/tmp/letta.js");
		spawnMock.mockImplementation(() => createChildProcess(0));

		const { ensureCompatibleProvider } = await import("./provider-bootstrap.ts");

		const result = await ensureCompatibleProvider({
			connectionType: "anthropic-compatible",
			LETTA_BASE_URL: "https://api.minimax.chat/v1/",
			LETTA_API_KEY: "sk-minimax",
			model: "MiniMax-M1",
		});

		expect(result).toMatchObject({
			providerType: "minimax",
			providerToken: "minimax",
			providerName: "lc-minimax",
			modelHandle: "lc-minimax/MiniMax-M1",
			modelName: "MiniMax-M1",
			serverBaseUrl: "http://127.0.0.1:8283",
		});
		expect(spawnMock).toHaveBeenCalledTimes(1);
		expect(spawnMock).toHaveBeenCalledWith(
			"node",
			[
				"/tmp/letta.js",
				"connect",
				"minimax",
				"--api-key",
				"sk-minimax",
				"--base-url",
				"https://api.minimax.chat/v1",
			],
			expect.objectContaining({
				cwd: process.cwd(),
				stdio: ["ignore", "pipe", "pipe"],
				env: expect.objectContaining({
					LETTA_BASE_URL: "http://127.0.0.1:8283",
					LETTA_API_KEY: "local-dev-key",
				}),
			}),
		);
	});
});
