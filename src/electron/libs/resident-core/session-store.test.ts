import { describe, expect, it } from "vitest";

import { createResidentCoreSessionStore } from "./session-store.js";

describe("ResidentCoreSessionStore", () => {
	it("tracks, rekeys, and clears projections", () => {
		const store = createResidentCoreSessionStore();
		const session = store.ensure("conv-store", {
			title: "Store session",
			status: "running",
		});

		expect(session.conversationId).toBe("conv-store");
		expect(store.list()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "conv-store",
					title: "Store session",
				}),
			]),
		);

		store.rekey("conv-store", "conv-store-next", {
			title: "Store session next",
			status: "running",
		});

		expect(store.get("conv-store")).toBeUndefined();
		expect(store.get("conv-store-next")).toMatchObject({
			conversationId: "conv-store-next",
			title: "Store session next",
		});

		store.clear();
		expect(store.list()).toEqual([]);
	});
});
