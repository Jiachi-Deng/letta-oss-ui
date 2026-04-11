import { app } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SessionStatus, StreamMessage } from "../../types.js";
import {
	clearAllSessionProjections,
	createSessionProjection,
	getAllSessionProjections,
	type SessionProjection,
} from "../runtime-state.js";

const RESIDENT_CORE_SESSION_PROJECTION_DIR = "resident-core";
const RESIDENT_CORE_SESSION_PROJECTION_FILE = "session-projections.json";
const RESIDENT_CORE_SESSION_PROJECTION_VERSION = 1;

export type ResidentCorePersistedSessionProjection = {
	conversationId: string;
	title: string;
	cwd?: string;
	createdAt: number;
	updatedAt: number;
	agentId?: string;
	status: SessionStatus;
	error?: string;
	messages: StreamMessage[];
};

export type ResidentCorePersistedSessionProjectionState = {
	schemaVersion: number;
	sessions: ResidentCorePersistedSessionProjection[];
};

function createEmptyState(): ResidentCorePersistedSessionProjectionState {
	return {
		schemaVersion: RESIDENT_CORE_SESSION_PROJECTION_VERSION,
		sessions: [],
	};
}

function normalizeStatus(status: unknown): SessionStatus {
	if (status === "idle" || status === "running" || status === "completed" || status === "error") {
		return status === "running" ? "idle" : status;
	}
	return "idle";
}

function cloneMessage(message: StreamMessage): StreamMessage {
	return { ...message } as StreamMessage;
}

function normalizeSessionProjection(value: unknown): ResidentCorePersistedSessionProjection | null {
	if (!value || typeof value !== "object") return null;

	const raw = value as Partial<ResidentCorePersistedSessionProjection>;
	if (typeof raw.conversationId !== "string" || !raw.conversationId.trim()) return null;
	if (typeof raw.title !== "string" || !raw.title.trim()) return null;
	if (typeof raw.createdAt !== "number" || !Number.isFinite(raw.createdAt)) return null;
	if (typeof raw.updatedAt !== "number" || !Number.isFinite(raw.updatedAt)) return null;

	const status = normalizeStatus(raw.status);
	const wasRunning = raw.status === "running";

	return {
		conversationId: raw.conversationId.trim(),
		title: raw.title.trim(),
		cwd: typeof raw.cwd === "string" && raw.cwd.trim() ? raw.cwd.trim() : undefined,
		createdAt: raw.createdAt,
		updatedAt: raw.updatedAt,
		agentId: typeof raw.agentId === "string" && raw.agentId.trim() ? raw.agentId.trim() : undefined,
		status,
		error: wasRunning ? undefined : typeof raw.error === "string" && raw.error.trim() ? raw.error.trim() : undefined,
		messages: Array.isArray(raw.messages) ? raw.messages.map(cloneMessage) : [],
	};
}

function normalizeState(value: unknown): ResidentCorePersistedSessionProjectionState {
	if (!value || typeof value !== "object") {
		return createEmptyState();
	}

	const raw = value as Partial<ResidentCorePersistedSessionProjectionState>;
	const sessions = Array.isArray(raw.sessions)
		? raw.sessions.map(normalizeSessionProjection).filter((session): session is ResidentCorePersistedSessionProjection => Boolean(session))
		: [];

	return {
		schemaVersion: typeof raw.schemaVersion === "number" ? raw.schemaVersion : RESIDENT_CORE_SESSION_PROJECTION_VERSION,
		sessions,
	};
}

export function getResidentCoreSessionProjectionStatePath(userDataPath = app.getPath("userData")): string {
	return join(userDataPath, RESIDENT_CORE_SESSION_PROJECTION_DIR, RESIDENT_CORE_SESSION_PROJECTION_FILE);
}

export function readResidentCoreSessionProjectionState(userDataPath = app.getPath("userData")): ResidentCorePersistedSessionProjectionState {
	const storagePath = getResidentCoreSessionProjectionStatePath(userDataPath);
	if (!existsSync(storagePath)) {
		return createEmptyState();
	}

	try {
		const raw = readFileSync(storagePath, "utf-8");
		return normalizeState(JSON.parse(raw) as unknown);
	} catch (error) {
		console.warn("[resident-core] Failed to read resident core session projection state:", storagePath, error);
		return createEmptyState();
	}
}

function createResidentCoreSessionProjectionStateTempPath(storagePath: string): string {
	return `${storagePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
}

async function writeResidentCoreSessionProjectionStateAtomic(
	storagePath: string,
	serializedState: string,
): Promise<void> {
	const tempPath = createResidentCoreSessionProjectionStateTempPath(storagePath);

	try {
		await mkdir(dirname(storagePath), { recursive: true });
		await writeFile(tempPath, serializedState, "utf-8");
		await rename(tempPath, storagePath);
	} catch (error) {
		try {
			await unlink(tempPath);
		} catch {
			// Best-effort temp cleanup.
		}
		console.warn("[resident-core] Failed to write resident core session projection state:", error);
	}
}

export async function writeResidentCoreSessionProjectionState(
	userDataPath: string,
	state: ResidentCorePersistedSessionProjectionState,
): Promise<void> {
	const storagePath = getResidentCoreSessionProjectionStatePath(userDataPath);
	await writeResidentCoreSessionProjectionStateAtomic(storagePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function snapshotResidentCoreSessionProjections(): ResidentCorePersistedSessionProjectionState {
	return {
		schemaVersion: RESIDENT_CORE_SESSION_PROJECTION_VERSION,
		sessions: [...getAllSessionProjections().values()]
			.map((session: SessionProjection) => ({
				conversationId: session.conversationId,
				title: session.title,
				cwd: session.cwd,
				createdAt: session.createdAt,
				updatedAt: session.updatedAt,
				agentId: session.agentId,
				status: session.status,
				error: session.error,
				messages: session.messages.map(cloneMessage),
			})),
	};
}

export function hydrateResidentCoreSessionProjections(userDataPath = app.getPath("userData")): void {
	const state = readResidentCoreSessionProjectionState(userDataPath);
	clearAllSessionProjections();

	for (const session of state.sessions) {
		createSessionProjection(session.conversationId, {
			title: session.title,
			cwd: session.cwd,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			agentId: session.agentId,
			status: session.status,
			error: session.error,
			messages: session.messages.map(cloneMessage),
		});
	}
}
