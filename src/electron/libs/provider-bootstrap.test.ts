import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOT_CONN_001, BOOT_CONN_002 } from "../../shared/decision-ids.js";
import { E_PROVIDER_CONNECT_FAILED } from "../../shared/error-codes.js";

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

	it("resolves a direct server runtime connection without compatible bootstrap", async () => {
		process.env.LETTA_CLI_PATH = "/tmp/letta.js";
		existsSyncMock.mockImplementation((candidate) => candidate === "/tmp/letta.js");
		const events: Array<Record<string, unknown>> = [];
		const trace = await import("./trace.ts");
		trace.setTraceSink((event) => {
			events.push(event as unknown as Record<string, unknown>);
		});

		try {
			const { prepareRuntimeConnection } = await import("./provider-bootstrap.ts");

			const result = await prepareRuntimeConnection(
				{
					connectionType: "letta-server",
					LETTA_BASE_URL: "http://localhost:8283",
					model: "gpt-4o",
				},
				{ traceId: "trc_direct", turnId: "turn_direct", sessionId: "conv_direct" },
			);

			expect(result).toMatchObject({
				baseUrl: "http://localhost:8283",
				apiKey: "local-dev-key",
				modelHandle: "gpt-4o",
				bootstrapAction: { kind: "none" },
			});
			expect(spawnMock).not.toHaveBeenCalled();
			expect(process.env.LETTA_BASE_URL).toBe("http://localhost:8283");
			expect(process.env.LETTA_API_KEY).toBe("local-dev-key");
			expect(process.env.LETTA_CLI_PATH).toBe("/tmp/letta.js");
			expect(events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						component: "provider-bootstrap",
						trace_id: "trc_direct",
						turn_id: "turn_direct",
						session_id: "conv_direct",
						decision_id: BOOT_CONN_001,
					}),
					expect.objectContaining({
						component: "provider-bootstrap",
						trace_id: "trc_direct",
						turn_id: "turn_direct",
						session_id: "conv_direct",
						decision_id: BOOT_CONN_002,
					}),
				]),
			);
		} finally {
			trace.resetTraceSink();
		}
	});

	it("emits a traced provider bootstrap failure with a stable error code", async () => {
		process.env.LETTA_CLI_PATH = "/tmp/letta.js";
		process.env.LETTA_LOCAL_SERVER_URL = "http://127.0.0.1:8283/";
		existsSyncMock.mockImplementation((candidate) => candidate === "/tmp/letta.js");
		spawnMock.mockImplementation(() => createChildProcess(1));
		const events: Array<Record<string, unknown>> = [];
		const trace = await import("./trace.ts");
		trace.setTraceSink((event) => {
			events.push(event as unknown as Record<string, unknown>);
		});

		try {
			const { prepareRuntimeConnection } = await import("./provider-bootstrap.ts");

			await expect(
				prepareRuntimeConnection(
					{
						connectionType: "anthropic-compatible",
						LETTA_BASE_URL: "https://api.minimax.chat/v1/",
						LETTA_API_KEY: "sk-minimax",
						model: "MiniMax-M1",
					},
					{ traceId: "trc_fail", turnId: "turn_fail", sessionId: "conv_fail" },
				),
			).rejects.toThrow(/letta connect failed with exit code 1/i);

			expect(events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						component: "provider-bootstrap",
						trace_id: "trc_fail",
						turn_id: "turn_fail",
						session_id: "conv_fail",
						decision_id: BOOT_CONN_001,
					}),
					expect.objectContaining({
						component: "provider-bootstrap",
						trace_id: "trc_fail",
						turn_id: "turn_fail",
						session_id: "conv_fail",
						decision_id: BOOT_CONN_002,
						error_code: E_PROVIDER_CONNECT_FAILED,
					}),
				]),
			);
		} finally {
			trace.resetTraceSink();
		}
	});
});
