import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		isPackaged: false,
		getPath: vi.fn(() => "/tmp/letta-desktop-test"),
	},
}));

import {
	getResidentCoreSessionProjectionStatePath,
	readResidentCoreSessionProjectionState,
	writeResidentCoreSessionProjectionState,
} from "./session-projection-persistence.js";

describe("ResidentCoreSessionStore", () => {
	let userDataPath: string;

	beforeEach(() => {
		userDataPath = mkdtempSync(join(tmpdir(), "letta-resident-core-sessions-"));
	});

	afterEach(async () => {
		rmSync(userDataPath, { recursive: true, force: true });
		const { clearAllSessionProjections } = await import("../runtime-state.js");
		clearAllSessionProjections();
		vi.clearAllMocks();
	});

	it("persists projections across store recreation", async () => {
		const { createResidentCoreSessionStore } = await import("./session-store.js");
		const store = createResidentCoreSessionStore(userDataPath);

		store.ensure("conv-store", {
			title: "Store session",
			cwd: "/tmp/workspace",
			status: "running",
		});
		store.appendUserPrompt("conv-store", "hello");
		store.appendMessage("conv-store", { type: "assistant", uuid: "msg-1", content: "hi" } as never);
		await store.flushPersistence();

		const reloaded = createResidentCoreSessionStore(userDataPath);
		expect(reloaded.list()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "conv-store",
					title: "Store session",
					status: "idle",
				}),
			]),
		);
		expect(reloaded.get("conv-store")).toMatchObject({
			conversationId: "conv-store",
			title: "Store session",
			status: "idle",
			cwd: "/tmp/workspace",
		});
		expect(reloaded.history("conv-store")).toEqual([
			{ type: "user_prompt", prompt: "hello" },
			{ type: "assistant", uuid: "msg-1", content: "hi" },
		]);
		expect(reloaded.get("conv-store")?.pendingPermissions.size).toBe(0);
	});

	it("updates the durable backing on rekey, delete, and clear", async () => {
		const { createResidentCoreSessionStore } = await import("./session-store.js");
		const store = createResidentCoreSessionStore(userDataPath);

		store.ensure("conv-store", {
			title: "Store session",
			status: "running",
		});
		await store.flushPersistence();

		store.rekey("conv-store", "conv-store-next", {
			title: "Store session next",
			status: "running",
		});
		await store.flushPersistence();
		expect(readResidentCoreSessionProjectionState(userDataPath).sessions).toEqual(
			[
				expect.objectContaining({
					conversationId: "conv-store-next",
					title: "Store session next",
				}),
			],
		);

		expect(store.delete("conv-store-next")).toBe(true);
		await store.flushPersistence();
		expect(readResidentCoreSessionProjectionState(userDataPath).sessions).toEqual([]);

		store.ensure("conv-store-clear", {
			title: "Clear me",
			status: "completed",
		});
		await store.flushPersistence();
		store.clear();
		await store.flushPersistence();
		expect(readResidentCoreSessionProjectionState(userDataPath).sessions).toEqual([]);
	});

	it("coalesces queued writes and persists the latest snapshot after an in-flight write", async () => {
		vi.useFakeTimers();
		const { createResidentCoreSessionStore } = await import("./session-store.js");
		const persistence = await import("./session-projection-persistence.js");
		const writeSpy = vi.spyOn(persistence, "writeResidentCoreSessionProjectionState");
		try {
			const writes: Array<{ sessions: Array<{ conversationId: string; title: string; status: string; messages: unknown[] }> }> = [];
			let releaseFirstWrite: (() => void) | null = null;
			let firstWrite = true;

			writeSpy.mockImplementation(async (_userDataPath, state) => {
				writes.push(JSON.parse(JSON.stringify(state)) as never);
				if (firstWrite) {
					firstWrite = false;
					await new Promise<void>((resolve) => {
						releaseFirstWrite = resolve;
					});
				}
			});

			const store = createResidentCoreSessionStore(userDataPath);
			store.ensure("conv-queue", {
				title: "Async session",
				status: "running",
			});

			await vi.advanceTimersByTimeAsync(50);
			expect(writes).toHaveLength(1);

			store.appendUserPrompt("conv-queue", "hello");
			store.appendMessage("conv-queue", { type: "assistant", uuid: "msg-1", content: "hi" } as never);

			releaseFirstWrite?.();
			await store.flushPersistence();

			expect(writes).toHaveLength(2);
			expect(writes[0].sessions[0]).toMatchObject({
				conversationId: "conv-queue",
				title: "Async session",
				status: "running",
				messages: [],
			});
			expect(writes[1].sessions[0]).toMatchObject({
				conversationId: "conv-queue",
				title: "Async session",
				status: "running",
				messages: [
					{ type: "user_prompt", prompt: "hello" },
					{ type: "assistant", uuid: "msg-1", content: "hi" },
				],
			});
		} finally {
			writeSpy.mockRestore();
			vi.useRealTimers();
		}
	});

	it("uses a slower debounce for content appends than structural mutations", async () => {
		vi.useFakeTimers();
		const { createResidentCoreSessionStore } = await import("./session-store.js");
		const persistence = await import("./session-projection-persistence.js");
		const writeSpy = vi.spyOn(persistence, "writeResidentCoreSessionProjectionState");
		const contentUserDataPath = mkdtempSync(join(tmpdir(), "letta-resident-core-sessions-content-"));
		const structuralUserDataPath = mkdtempSync(join(tmpdir(), "letta-resident-core-sessions-structural-"));

		writeSpy.mockImplementation(async () => undefined);

		try {
			const contentStore = createResidentCoreSessionStore(contentUserDataPath);
			contentStore.appendUserPrompt("conv-content", "hello");

			await vi.advanceTimersByTimeAsync(249);
			expect(writeSpy).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1);
			expect(writeSpy).toHaveBeenCalledTimes(1);

			writeSpy.mockClear();

			const structuralStore = createResidentCoreSessionStore(structuralUserDataPath);
			structuralStore.ensure("conv-structural", {
				title: "Structural session",
				status: "running",
			});

			await vi.advanceTimersByTimeAsync(49);
			expect(writeSpy).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1);
			expect(writeSpy).toHaveBeenCalledTimes(1);
		} finally {
			writeSpy.mockRestore();
			vi.useRealTimers();
			rmSync(contentUserDataPath, { recursive: true, force: true });
			rmSync(structuralUserDataPath, { recursive: true, force: true });
		}
	});

	it("pulls an earlier structural mutation ahead of a pending content debounce", async () => {
		vi.useFakeTimers();
		const { createResidentCoreSessionStore } = await import("./session-store.js");
		const persistence = await import("./session-projection-persistence.js");
		const writeSpy = vi.spyOn(persistence, "writeResidentCoreSessionProjectionState");
		const userDataPath = mkdtempSync(join(tmpdir(), "letta-resident-core-sessions-pull-"));

		writeSpy.mockImplementation(async () => undefined);

		try {
			const store = createResidentCoreSessionStore(userDataPath);
			store.appendUserPrompt("conv-pull", "hello");

			await vi.advanceTimersByTimeAsync(100);
			expect(writeSpy).not.toHaveBeenCalled();

			store.update("conv-pull", { title: "Pulled forward" });

			await vi.advanceTimersByTimeAsync(49);
			expect(writeSpy).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1);
			expect(writeSpy).toHaveBeenCalledTimes(1);
		} finally {
			writeSpy.mockRestore();
			vi.useRealTimers();
			rmSync(userDataPath, { recursive: true, force: true });
		}
	});

	it("flushPersistence forces the latest snapshot out immediately", async () => {
		const { createResidentCoreSessionStore } = await import("./session-store.js");
		const persistence = await import("./session-projection-persistence.js");
		const writeSpy = vi.spyOn(persistence, "writeResidentCoreSessionProjectionState");
		const userDataPath = mkdtempSync(join(tmpdir(), "letta-resident-core-sessions-flush-"));

		writeSpy.mockImplementation(async () => undefined);

		try {
			const store = createResidentCoreSessionStore(userDataPath);
			store.ensure("conv-flush", {
				title: "Flush session",
				status: "running",
			});
			store.appendUserPrompt("conv-flush", "hello");
			store.appendMessage("conv-flush", { type: "assistant", uuid: "msg-flush", content: "hi" } as never);

			await store.flushPersistence();

			expect(writeSpy).toHaveBeenCalledTimes(1);
			expect(writeSpy.mock.calls[0][1]).toMatchObject({
				sessions: [
					expect.objectContaining({
						conversationId: "conv-flush",
						title: "Flush session",
						messages: [
							{ type: "user_prompt", prompt: "hello" },
							{ type: "assistant", uuid: "msg-flush", content: "hi" },
						],
					}),
				],
			});
		} finally {
			writeSpy.mockRestore();
			rmSync(userDataPath, { recursive: true, force: true });
		}
	});

	it("does not queue durable persistence for stream_event-only appends", async () => {
		const { createResidentCoreSessionStore } = await import("./session-store.js");
		const persistence = await import("./session-projection-persistence.js");
		const writeSpy = vi.spyOn(persistence, "writeResidentCoreSessionProjectionState");
		try {
			const store = createResidentCoreSessionStore(userDataPath);

			store.ensure("conv-stream", {
				title: "Stream session",
				status: "running",
			});
			await store.flushPersistence();
			writeSpy.mockClear();

			const reloaded = createResidentCoreSessionStore(userDataPath);
			expect(reloaded.history("conv-stream")).toEqual([]);

			store.appendMessage("conv-stream", {
				type: "stream_event",
				uuid: "stream-1",
			} as never);
			await store.flushPersistence();

			expect(writeSpy).not.toHaveBeenCalled();
			expect(store.history("conv-stream")).toEqual([]);
			expect(createResidentCoreSessionStore(userDataPath).history("conv-stream")).toEqual([]);
			expect(readResidentCoreSessionProjectionState(userDataPath).sessions).toEqual([
				expect.objectContaining({
					conversationId: "conv-stream",
					title: "Stream session",
					status: "idle",
				}),
			]);
		} finally {
			writeSpy.mockRestore();
		}
	});

	it("sanitizes hydrated running sessions and drops pending permissions", async () => {
		await writeResidentCoreSessionProjectionState(userDataPath, {
			schemaVersion: 1,
			sessions: [
				{
					conversationId: "conv-hydrate",
					title: "Hydrated session",
					createdAt: 10,
					updatedAt: 20,
					status: "running",
					error: "transient",
					messages: [{ type: "assistant", uuid: "msg-2", content: "hello" } as never],
				},
			],
		});

		const { createResidentCoreSessionStore } = await import("./session-store.js");
		const store = createResidentCoreSessionStore(userDataPath);

		const session = store.get("conv-hydrate");
		expect(session).toMatchObject({
			conversationId: "conv-hydrate",
			title: "Hydrated session",
			status: "idle",
		});
		expect(session?.error).toBeUndefined();
		expect(session?.pendingPermissions.size).toBe(0);
		expect(store.history("conv-hydrate")).toEqual([
			{ type: "assistant", uuid: "msg-2", content: "hello" },
		]);
	});

	it("exposes the durable state file path under userData", async () => {
		expect(getResidentCoreSessionProjectionStatePath(userDataPath)).toBe(
			join(userDataPath, "resident-core", "session-projections.json"),
		);
	});
});
