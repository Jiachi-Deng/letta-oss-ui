import { beforeEach, describe, expect, it, vi } from "vitest";

const getAppConfigStateMock = vi.hoisted(() => vi.fn());
const prepareRuntimeConnectionMock = vi.hoisted(() => vi.fn());

vi.mock("../config.js", () => ({
	getAppConfigState: getAppConfigStateMock,
}));

vi.mock("../provider-bootstrap.js", () => ({
	prepareRuntimeConnection: prepareRuntimeConnectionMock,
}));

vi.mock("electron", () => ({
	app: {
		isPackaged: false,
		getPath: vi.fn(() => "/tmp/letta-desktop-test"),
	},
}));

describe("createResidentCoreRuntimeHost", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("exposes the app config and runtime connection providers used by the core", async () => {
		getAppConfigStateMock.mockReturnValue({ config: { connectionType: "letta-server" } });
		prepareRuntimeConnectionMock.mockResolvedValue({ baseUrl: "http://localhost", cliPath: "/tmp/letta.js", bootstrapAction: { kind: "none" } });

		const { createResidentCoreRuntimeHost } = await import("./runtime-host.js");
		const host = createResidentCoreRuntimeHost();

		expect(host.getAppConfigState()).toEqual({ config: { connectionType: "letta-server" } });
		await host.prepareRuntimeConnection({ connectionType: "letta-server" } as any, { traceId: "trc" } as any);
		expect(prepareRuntimeConnectionMock).toHaveBeenCalledTimes(1);
	});
});
