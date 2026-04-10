import { resolve, relative, isAbsolute } from "node:path";
import type { CanUseToolCallback, CanUseToolResponse } from "@letta-ai/letta-code-sdk";

export type ResidentCoreSafetyDecision = {
	allowed: boolean;
	message?: string;
};

const PATH_SCOPED_TOOL_NAMES = new Set([
	"read",
	"write",
	"edit",
	"multiedit",
	"multi_edit",
	"glob",
	"grep",
	"ls",
	"list_dir",
	"listdir",
	"list_directory",
	"read_file",
	"write_file",
	"readfile",
	"writefile",
	"read_file_gemini",
	"write_file_gemini",
	"readmanyfiles",
	"read_many_files",
	"grep_files",
	"search_file_content",
	"glob_gemini",
]);

const PATH_HINT_KEYS = new Set([
	"file_path",
	"filepath",
	"filePath",
	"path",
	"paths",
	"directory",
	"dir",
	"cwd",
	"root",
	"file",
	"files",
	"directories",
]);

function normalizeString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeToolName(toolName: string): string {
	return toolName.trim().toLowerCase();
}

function extractCommandLikeInput(toolInput: unknown): string | undefined {
	if (!toolInput || typeof toolInput !== "object") return undefined;

	const input = toolInput as Record<string, unknown>;
	for (const key of ["command", "script", "args", "cmd", "input"]) {
		const value = normalizeString(input[key]);
		if (value) return value;
	}
	return undefined;
}

function extractRawPathValue(raw: string): string | undefined {
	const match = raw.match(/(?:^|[\s,])(?:file_path|filepath|filePath|path|directory|dir|cwd|root)\s*=\s*("([^"]+)"|'([^']+)'|([^\s,]+))/i);
	return normalizeString(match?.[2] ?? match?.[3] ?? match?.[4]);
}

function pathIsWithinRoot(candidate: string, root: string): boolean {
	const normalizedCandidate = resolve(candidate);
	const normalizedRoot = resolve(root);
	if (normalizedCandidate === normalizedRoot) return true;
	const relativePath = relative(normalizedRoot, normalizedCandidate);
	return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function hasGlobCharacters(value: string): boolean {
	return /[*?[\]{}()!]/.test(value);
}

type CollectOptions = {
	allowPlainString: boolean;
};

function collectCandidateStrings(value: unknown, results: string[], options: CollectOptions, keyHint?: string): void {
	if (typeof value === "string") {
		if (options.allowPlainString) {
			results.push(value);
		}
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectCandidateStrings(item, results, options, keyHint);
		}
		return;
	}

	if (!value || typeof value !== "object") return;

	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		const normalizedKey = key.toLowerCase();
		if (PATH_HINT_KEYS.has(key) || PATH_HINT_KEYS.has(normalizedKey)) {
			collectCandidateStrings(nested, results, { allowPlainString: true }, normalizedKey);
			continue;
		}

		if (normalizedKey === "edits" || normalizedKey === "operations") {
			collectCandidateStrings(nested, results, { allowPlainString: false }, normalizedKey);
			continue;
		}

		if (normalizedKey === "pattern" && (keyHint === "glob" || keyHint === "glob_gemini" || keyHint === "ls" || keyHint === "list_dir" || keyHint === "listdir" || keyHint === "list_directory")) {
			collectCandidateStrings(nested, results, { allowPlainString: true }, normalizedKey);
			continue;
		}

		if (normalizedKey === "raw" && typeof nested === "string") {
			const rawPath = extractRawPathValue(nested);
			if (rawPath) {
				results.push(rawPath);
			} else {
				results.push(nested);
			}
			continue;
		}

		if (typeof nested === "object" && nested !== null) {
			collectCandidateStrings(nested, results, { allowPlainString: false }, keyHint);
		}
	}
}

function extractPathCandidates(toolName: string, toolInput: unknown): Array<{ value: string; isPattern: boolean }> {
	const normalizedToolName = normalizeToolName(toolName);
	const rawValues: string[] = [];
	collectCandidateStrings(
		toolInput,
		rawValues,
		{ allowPlainString: false },
		normalizedToolName,
	);

	return rawValues
		.map((value) => normalizeString(value))
		.filter((value): value is string => !!value && !value.startsWith("http://") && !value.startsWith("https://"))
		.map((value) => ({
			value,
			isPattern: (normalizedToolName === "glob" || normalizedToolName === "glob_gemini" || normalizedToolName === "ls" || normalizedToolName === "list_dir" || normalizedToolName === "listdir" || normalizedToolName === "list_directory")
				? hasGlobCharacters(value)
				: false,
		}));
}

function evaluateCommandScope(command: string, workingDir: string): ResidentCoreSafetyDecision {
	const normalizedWorkingDir = resolve(workingDir);
	const lower = command.toLowerCase();

	if (/\bsudo\b/.test(lower)) {
		return {
			allowed: false,
			message: "Blocked by Resident Core safety policy: sudo is not permitted.",
		};
	}

	if (/(^|[\s;&|(){}])rm\s+-[a-z]*r[a-z-]*f[a-z-]*/.test(lower) || /(^|[\s;&|(){}])rm\s+-[a-z]*f[a-z-]*r[a-z-]*/.test(lower)) {
		return {
			allowed: false,
			message: "Blocked by Resident Core safety policy: destructive rm -rf style commands are not permitted.",
		};
	}

	if (/\b(shutdown|reboot|poweroff|halt)\b/.test(lower)) {
		return {
			allowed: false,
			message: "Blocked by Resident Core safety policy: system shutdown/reboot commands are not permitted.",
		};
	}

	if (/\bmkfs(\.\w+)?\b/.test(lower) || /\bfdisk\b/.test(lower)) {
		return {
			allowed: false,
			message: "Blocked by Resident Core safety policy: filesystem creation/partitioning commands are not permitted.",
		};
	}

	if (/\bdiskutil\b.*\b(erase|eraseDisk|partitionDisk|secureErase|zeroDisk|format)\b/.test(lower)) {
		return {
			allowed: false,
			message: "Blocked by Resident Core safety policy: destructive diskutil commands are not permitted.",
		};
	}

	if (/\bdd\b/.test(lower) && /\b(if|of|bs|count)=/.test(lower)) {
		return {
			allowed: false,
			message: "Blocked by Resident Core safety policy: raw dd device operations are not permitted.",
		};
	}

	const tokens = command.match(/[^\s"'`]+|"[^"]*"|'[^']*'/g) ?? [];
	for (const rawToken of tokens) {
		const token = rawToken.replace(/^['"`]+|['"`]+$/g, "");
		if (!token || token.startsWith("http://") || token.startsWith("https://")) {
			continue;
		}

		if (token.startsWith("~")) {
			return {
				allowed: false,
				message: `Blocked by Resident Core safety policy: path "${token}" is outside the configured working directory.`,
			};
		}

		if (token.startsWith("/")) {
			const resolved = resolve(token);
			if (!pathIsWithinRoot(resolved, normalizedWorkingDir)) {
				return {
					allowed: false,
					message: `Blocked by Resident Core safety policy: path "${token}" is outside the configured working directory.`,
				};
			}
		}

		if (token.startsWith("..") || token.includes("/../") || token.includes("\\..\\")) {
			return {
				allowed: false,
				message: "Blocked by Resident Core safety policy: path traversal outside the working directory is not permitted.",
			};
		}
	}

	return { allowed: true };
}

function evaluatePathCandidate(candidate: string, workingDir: string, allowGlobPatterns: boolean): ResidentCoreSafetyDecision {
	const normalizedWorkingDir = resolve(workingDir);
	const trimmed = candidate.trim();
	if (!trimmed) return { allowed: true };

	if (trimmed.startsWith("~")) {
		return {
			allowed: false,
			message: `Blocked by Resident Core safety policy: path "${trimmed}" is outside the configured working directory.`,
		};
	}

	if (trimmed.startsWith("..") || trimmed.includes("/../") || trimmed.includes("\\..\\")) {
		return {
			allowed: false,
			message: "Blocked by Resident Core safety policy: path traversal outside the working directory is not permitted.",
		};
	}

	if (allowGlobPatterns && hasGlobCharacters(trimmed)) {
		const staticPrefix = trimmed.split(/[*?[\]{}()!]/, 1)[0] ?? "";
		if (!staticPrefix) {
			return { allowed: true };
		}

		const resolvedPrefix = staticPrefix.startsWith("/") ? resolve(staticPrefix) : resolve(normalizedWorkingDir, staticPrefix);
		if (!pathIsWithinRoot(resolvedPrefix, normalizedWorkingDir)) {
			return {
				allowed: false,
				message: `Blocked by Resident Core safety policy: path "${trimmed}" is outside the configured working directory.`,
			};
		}
		return { allowed: true };
	}

	const resolved = trimmed.startsWith("/") ? resolve(trimmed) : resolve(normalizedWorkingDir, trimmed);
	if (!pathIsWithinRoot(resolved, normalizedWorkingDir)) {
		return {
			allowed: false,
			message: `Blocked by Resident Core safety policy: path "${trimmed}" is outside the configured working directory.`,
		};
	}

	return { allowed: true };
}

function evaluatePathScopedTool(toolName: string, toolInput: unknown, workingDir: string): ResidentCoreSafetyDecision {
	const normalizedToolName = normalizeToolName(toolName);
	const allowGlobPatterns =
		normalizedToolName === "glob" ||
		normalizedToolName === "glob_gemini" ||
		normalizedToolName === "ls" ||
		normalizedToolName === "list_dir" ||
		normalizedToolName === "listdir" ||
		normalizedToolName === "list_directory";

	for (const candidate of extractPathCandidates(toolName, toolInput)) {
		const decision = evaluatePathCandidate(candidate.value, workingDir, allowGlobPatterns || candidate.isPattern);
		if (!decision.allowed) return decision;
	}

	return { allowed: true };
}

export function evaluateResidentCoreToolUse(
	toolName: string,
	toolInput: unknown,
	workingDir: string,
): ResidentCoreSafetyDecision {
	const normalizedToolName = normalizeToolName(toolName);
	if (normalizedToolName === "bash" || normalizedToolName === "shell" || normalizedToolName === "sh" || normalizedToolName === "zsh") {
		const command = extractCommandLikeInput(toolInput);
		if (!command) {
			return {
				allowed: false,
				message: "Blocked by Resident Core safety policy: shell commands must include an explicit command string.",
			};
		}
		return evaluateCommandScope(command, workingDir);
	}

	if (PATH_SCOPED_TOOL_NAMES.has(normalizedToolName)) {
		return evaluatePathScopedTool(normalizedToolName, toolInput, workingDir);
	}

	return { allowed: true };
}

export function createResidentCoreSafetyCanUseTool(
	workingDir: string,
	delegate?: CanUseToolCallback,
): CanUseToolCallback {
	return async (toolName, toolInput): Promise<CanUseToolResponse> => {
		const safetyDecision = evaluateResidentCoreToolUse(toolName, toolInput, workingDir);
		if (!safetyDecision.allowed) {
			return {
				behavior: "deny",
				message: safetyDecision.message ?? "Blocked by Resident Core safety policy.",
				interrupt: true,
			};
		}

		if (delegate) {
			return delegate(toolName, toolInput);
		}

		return {
			behavior: "allow",
			updatedInput: null,
			updatedPermissions: [],
		};
	};
}
