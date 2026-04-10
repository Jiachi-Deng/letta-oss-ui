import { describe, expect, it, vi } from "vitest";

describe("Resident Core safety policy", () => {
	it("denies sudo and destructive shell commands", async () => {
		const { createResidentCoreSafetyCanUseTool } = await import("./safety.js");
		const canUseTool = createResidentCoreSafetyCanUseTool("/tmp/workspace");

		await expect(canUseTool("Bash", { command: "sudo rm -rf /" })).resolves.toMatchObject({
			behavior: "deny",
		});
		await expect(canUseTool("Bash", { command: "rm -rf /" })).resolves.toMatchObject({
			behavior: "deny",
		});
		await expect(canUseTool("Bash", { command: "shutdown now" })).resolves.toMatchObject({
			behavior: "deny",
		});
		await expect(canUseTool("Bash", { command: "mkfs.ext4 /dev/sda1" })).resolves.toMatchObject({
			behavior: "deny",
		});
		await expect(canUseTool("Bash", { command: "dd if=/dev/zero of=/dev/sda" })).resolves.toMatchObject({
			behavior: "deny",
		});
	});

	it("allows normal work commands and delegates when safe", async () => {
		const { createResidentCoreSafetyCanUseTool } = await import("./safety.js");
		const delegate = vi.fn(async () => ({ behavior: "allow" as const, updatedInput: { command: "pwd" } }));
		const canUseTool = createResidentCoreSafetyCanUseTool("/tmp/workspace", delegate);

		await expect(canUseTool("Bash", { command: "cd ./app && ls -la" })).resolves.toMatchObject({
			behavior: "allow",
		});
		expect(delegate).toHaveBeenCalledTimes(1);
	});

	it("denies file tool inputs outside the working directory", async () => {
		const { evaluateResidentCoreToolUse } = await import("./safety.js");

		await expect(evaluateResidentCoreToolUse("Write", { file_path: "/etc/passwd", content: "x" }, "/tmp/workspace")).toMatchObject({
			allowed: false,
		});
		await expect(evaluateResidentCoreToolUse("Edit", { file_path: "../outside.txt", old_string: "a", new_string: "b" }, "/tmp/workspace")).toMatchObject({
			allowed: false,
		});
		await expect(evaluateResidentCoreToolUse("MultiEdit", { file_path: "/etc/passwd", edits: [{ old_string: "a", new_string: "b" }] }, "/tmp/workspace")).toMatchObject({
			allowed: false,
		});
		await expect(evaluateResidentCoreToolUse("Glob", { pattern: "/etc/**/*.conf" }, "/tmp/workspace")).toMatchObject({
			allowed: false,
		});
		await expect(evaluateResidentCoreToolUse("LS", { path: "~/secrets" }, "/tmp/workspace")).toMatchObject({
			allowed: false,
		});
	});

	it("allows in-root file tool inputs", async () => {
		const { evaluateResidentCoreToolUse } = await import("./safety.js");

		await expect(evaluateResidentCoreToolUse("Read", { file_path: "src/index.ts" }, "/tmp/workspace")).toMatchObject({
			allowed: true,
		});
		await expect(evaluateResidentCoreToolUse("Glob", { pattern: "src/**/*.ts", path: "." }, "/tmp/workspace")).toMatchObject({
			allowed: true,
		});
		await expect(evaluateResidentCoreToolUse("LS", { path: "src" }, "/tmp/workspace")).toMatchObject({
			allowed: true,
		});
	});

	it("denies obvious working directory escapes", async () => {
		const { createResidentCoreSafetyCanUseTool } = await import("./safety.js");
		const canUseTool = createResidentCoreSafetyCanUseTool("/tmp/workspace");

		await expect(canUseTool("Bash", { command: "cd ../outside && ls" })).resolves.toMatchObject({
			behavior: "deny",
		});
		await expect(canUseTool("Bash", { command: "cat /etc/passwd" })).resolves.toMatchObject({
			behavior: "deny",
		});
		await expect(canUseTool("Bash", { command: "cat ~/secrets.txt" })).resolves.toMatchObject({
			behavior: "deny",
		});
	});
});
