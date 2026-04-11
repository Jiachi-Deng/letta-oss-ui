import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LettaAppConfig } from "../config.js";
import type { TraceContext } from "../trace.js";

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
		const diagnostics = await import("../diagnostics.js");
		diagnostics.resetDiagnosticsForTests();
		getAppConfigStateMock.mockReturnValue({ config: { connectionType: "letta-server" } });
		prepareRuntimeConnectionMock.mockResolvedValue({ baseUrl: "http://localhost", cliPath: "/tmp/letta.js", bootstrapAction: { kind: "none" } });

		const { createResidentCoreRuntimeHost } = await import("./runtime-host.js");
		const host = createResidentCoreRuntimeHost();

		expect(host.getAppConfigState()).toEqual({ config: { connectionType: "letta-server" } });
		await host.prepareRuntimeConnection(
			{ connectionType: "letta-server" } as LettaAppConfig,
			{ traceId: "trc" } as TraceContext,
		);
		expect(prepareRuntimeConnectionMock).toHaveBeenCalledTimes(1);
		expect(diagnostics.getDiagnosticSummary("trc")).toMatchObject({
			lastSuccessfulDecisionId: "RC_RUNTIME_PREP_002",
		});
	});

	it("records a diagnostic failure when runtime preparation fails", async () => {
		const diagnostics = await import("../diagnostics.js");
		diagnostics.resetDiagnosticsForTests();
		getAppConfigStateMock.mockReturnValue({ config: { connectionType: "letta-server" } });
		prepareRuntimeConnectionMock.mockRejectedValue(new Error("bootstrap failed"));

		const { createResidentCoreRuntimeHost } = await import("./runtime-host.js");
		const host = createResidentCoreRuntimeHost();

		await expect(host.prepareRuntimeConnection(
			{ connectionType: "letta-server" } as LettaAppConfig,
			{ traceId: "trc_runtime_fail" } as TraceContext,
		)).rejects.toThrow("bootstrap failed");
		expect(diagnostics.getDiagnosticSummary("trc_runtime_fail")).toMatchObject({
			errorCode: "E_RESIDENT_CORE_RUNTIME_PREP_FAILED",
			firstFailedDecisionId: "RC_RUNTIME_PREP_003",
		});
	});
});
