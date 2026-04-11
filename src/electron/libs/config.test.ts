import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("electron", () => ({
	app: {
		isPackaged: true,
		getPath: vi.fn(() => "/tmp/letta-config-test"),
		setPath: vi.fn(),
		setName: vi.fn(),
		setAppUserModelId: vi.fn(),
	},
}));

describe("resident core config normalization", () => {
	let userDataPath: string;

	beforeEach(() => {
		vi.resetModules();
		userDataPath = fs.mkdtempSync(join(tmpdir(), "letta-config-"));
	});

	afterEach(() => {
		fs.rmSync(userDataPath, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	function writeConfigFile(config: unknown): void {
		fs.writeFileSync(join(userDataPath, "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
	}

	it("normalizes legacy residentCore.telegram into residentCore.channels.telegram", async () => {
		writeConfigFile({
			connectionType: "letta-server",
			LETTA_BASE_URL: "https://api.letta.com",
			residentCore: {
				telegram: {
					token: "legacy-token",
					dmPolicy: "open",
					streaming: false,
					workingDir: "/tmp/legacy",
				},
			},
		});

		const { initializeAppConfig } = await import("./config.js");
		const result = initializeAppConfig({ packaged: true, userDataPath });

		expect(result.config.residentCore).toEqual({
			channels: {
				telegram: {
					token: "legacy-token",
					dmPolicy: "open",
					streaming: false,
					workingDir: "/tmp/legacy",
				},
			},
		});
	});

	it("preserves residentCore.channels.telegram when already normalized", async () => {
		writeConfigFile({
			connectionType: "letta-server",
			LETTA_BASE_URL: "https://api.letta.com",
			residentCore: {
				channels: {
					telegram: {
						token: "channel-token",
						dmPolicy: "allowlist",
						streaming: true,
						workingDir: "/tmp/channel",
					},
				},
			},
		});

		const { initializeAppConfig } = await import("./config.js");
		const result = initializeAppConfig({ packaged: true, userDataPath });

		expect(result.config.residentCore).toEqual({
			channels: {
				telegram: {
					token: "channel-token",
					dmPolicy: "allowlist",
					streaming: true,
					workingDir: "/tmp/channel",
				},
			},
		});
	});
});
