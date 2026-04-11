import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const RESIDENT_CORE_STATE_DIR = "resident-core";
const RESIDENT_CORE_STATE_FILE = "state.json";
const RESIDENT_CORE_STATE_VERSION = 1;
const DEFAULT_ACTIVE_AGENT_KEY = "primary";

export type ResidentCoreAgentEntry = {
	key: string;
	record: ResidentCoreAgentRecord;
};

export type ResidentCoreAgentRecord = {
	agentId: string;
	name?: string;
	lastUsedAt: string;
	conversationMode?: "shared";
	channels?: Record<string, boolean>;
};

export type ResidentCoreState = {
	schemaVersion: number;
	activeAgentKey: string;
	agents: Record<string, ResidentCoreAgentRecord>;
};

function createEmptyState(): ResidentCoreState {
	return {
		schemaVersion: RESIDENT_CORE_STATE_VERSION,
		activeAgentKey: DEFAULT_ACTIVE_AGENT_KEY,
		agents: {},
	};
}

function cloneAgentRecord(record: ResidentCoreAgentRecord): ResidentCoreAgentRecord {
	return {
		...record,
		...(record.channels ? { channels: { ...record.channels } } : {}),
	};
}

function normalizeAgentRecord(value: unknown): ResidentCoreAgentRecord | undefined {
	if (!value || typeof value !== "object") return undefined;

	const record = value as Partial<ResidentCoreAgentRecord>;
	if (typeof record.agentId !== "string" || !record.agentId.trim()) return undefined;
	if (typeof record.lastUsedAt !== "string" || !record.lastUsedAt.trim()) return undefined;

	const normalized: ResidentCoreAgentRecord = {
		agentId: record.agentId.trim(),
		lastUsedAt: record.lastUsedAt.trim(),
	};

	if (typeof record.name === "string" && record.name.trim()) {
		normalized.name = record.name.trim();
	}

	if (record.conversationMode === "shared") {
		normalized.conversationMode = record.conversationMode;
	}

	if (record.channels && typeof record.channels === "object") {
		normalized.channels = { ...record.channels };
	}

	return normalized;
}

function normalizeState(value: unknown): ResidentCoreState {
	if (!value || typeof value !== "object") return createEmptyState();

	const raw = value as Partial<ResidentCoreState>;
	const schemaVersion = typeof raw.schemaVersion === "number" ? raw.schemaVersion : RESIDENT_CORE_STATE_VERSION;
	const activeAgentKey = typeof raw.activeAgentKey === "string" && raw.activeAgentKey.trim()
		? raw.activeAgentKey.trim()
		: DEFAULT_ACTIVE_AGENT_KEY;
	const agents: Record<string, ResidentCoreAgentRecord> = {};

	if (raw.agents && typeof raw.agents === "object") {
		for (const [key, agentRecord] of Object.entries(raw.agents)) {
			const normalized = normalizeAgentRecord(agentRecord);
			if (normalized) {
				agents[key] = normalized;
			}
		}
	}

	return {
		schemaVersion,
		activeAgentKey,
		agents,
	};
}

export function getResidentCoreStatePath(userDataPath = app.getPath("userData")): string {
	return join(userDataPath, RESIDENT_CORE_STATE_DIR, RESIDENT_CORE_STATE_FILE);
}

export function readResidentCoreState(userDataPath = app.getPath("userData")): ResidentCoreState {
	const storagePath = getResidentCoreStatePath(userDataPath);
	if (!existsSync(storagePath)) {
		return createEmptyState();
	}

	try {
		const raw = readFileSync(storagePath, "utf-8");
		return normalizeState(JSON.parse(raw) as unknown);
	} catch (error) {
		console.warn("[resident-core] Failed to read resident core state:", storagePath, error);
		return createEmptyState();
	}
}

export function writeResidentCoreState(userDataPath: string, state: ResidentCoreState): void {
	try {
		const storagePath = getResidentCoreStatePath(userDataPath);
		mkdirSync(dirname(storagePath), { recursive: true });
		writeFileSync(storagePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
	} catch (error) {
		console.warn("[resident-core] Failed to write resident core state:", error);
	}
}

export class ResidentCoreStateStore {
	private state: ResidentCoreState;

	constructor(private readonly userDataPath = app.getPath("userData")) {
		this.state = readResidentCoreState(this.userDataPath);
	}

	getActiveAgentKey(): string {
		return this.state.activeAgentKey;
	}

	getActiveAgentRecord(): ResidentCoreAgentRecord | null {
		return this.getAgentRecord(this.state.activeAgentKey);
	}

	getActiveAgentId(): string | null {
		return this.getActiveAgentRecord()?.agentId ?? null;
	}

	getAgentRecord(key: string): ResidentCoreAgentRecord | null {
		const normalizedKey = key.trim();
		if (!normalizedKey) return null;

		const record = this.state.agents[normalizedKey];
		return record ? cloneAgentRecord(record) : null;
	}

	listAgents(): ResidentCoreAgentEntry[] {
		return Object.entries(this.state.agents)
			.map(([key, record]) => ({
				key,
				record: cloneAgentRecord(record),
			}))
			.sort((a, b) => a.key.localeCompare(b.key));
	}

	deleteAgentRecord(key: string): ResidentCoreAgentEntry | null {
		const normalizedKey = key.trim();
		if (!normalizedKey) return null;

		const existing = this.state.agents[normalizedKey];
		if (!existing) return null;

		const nextAgents = { ...this.state.agents };
		delete nextAgents[normalizedKey];

		let nextActiveAgentKey = this.state.activeAgentKey;
		if (nextActiveAgentKey === normalizedKey) {
			nextActiveAgentKey = Object.keys(nextAgents).sort((a, b) => a.localeCompare(b))[0] ?? DEFAULT_ACTIVE_AGENT_KEY;
		}

		this.state = {
			...this.state,
			activeAgentKey: nextActiveAgentKey,
			agents: nextAgents,
		};
		writeResidentCoreState(this.userDataPath, this.state);
		return {
			key: normalizedKey,
			record: cloneAgentRecord(existing),
		};
	}

	setActiveAgentKey(key: string): boolean {
		const normalizedKey = key.trim();
		if (!normalizedKey) return false;
		if (!this.state.agents[normalizedKey]) return false;
		if (this.state.activeAgentKey === normalizedKey) return false;

		this.state = {
			...this.state,
			activeAgentKey: normalizedKey,
		};
		writeResidentCoreState(this.userDataPath, this.state);
		return true;
	}

	upsertAgentRecord(
		key: string,
		record: Omit<ResidentCoreAgentRecord, "lastUsedAt"> & Partial<Pick<ResidentCoreAgentRecord, "lastUsedAt">>,
		activate = false,
	): ResidentCoreAgentRecord | null {
		const normalizedKey = key.trim();
		const agentId = record.agentId.trim();
		if (!normalizedKey || !agentId) return null;

		const existing = this.state.agents[normalizedKey];
		const nextRecord: ResidentCoreAgentRecord = {
			agentId,
			lastUsedAt: record.lastUsedAt?.trim() || existing?.lastUsedAt || new Date().toISOString(),
			...(record.name?.trim() ? { name: record.name.trim() } : existing?.name ? { name: existing.name } : {}),
			...(record.conversationMode ? { conversationMode: record.conversationMode } : existing?.conversationMode ? { conversationMode: existing.conversationMode } : {}),
			...(record.channels ? { channels: { ...record.channels } } : existing?.channels ? { channels: { ...existing.channels } } : {}),
		};

		this.state = {
			...this.state,
			agents: {
				...this.state.agents,
				[normalizedKey]: nextRecord,
			},
			activeAgentKey: (activate || !this.state.agents[this.state.activeAgentKey])
				? normalizedKey
				: this.state.activeAgentKey,
		};
		writeResidentCoreState(this.userDataPath, this.state);
		return cloneAgentRecord(nextRecord);
	}

	rememberActiveAgent(agentId: string): boolean {
		const trimmedAgentId = agentId.trim();
		if (!trimmedAgentId) return false;

		const currentKey = this.state.activeAgentKey || DEFAULT_ACTIVE_AGENT_KEY;
		const currentRecord = this.state.agents[currentKey];
		if (currentRecord && currentRecord.agentId !== trimmedAgentId) {
			return false;
		}
		this.upsertAgentRecord(
			currentKey,
			{
				agentId: trimmedAgentId,
				lastUsedAt: new Date().toISOString(),
				...(currentRecord?.name ? { name: currentRecord.name } : {}),
				...(currentRecord?.conversationMode ? { conversationMode: currentRecord.conversationMode } : {}),
				...(currentRecord?.channels ? { channels: { ...currentRecord.channels } } : {}),
			},
			true,
		);
		return true;
	}

	setActiveAgent(agentId: string, key = DEFAULT_ACTIVE_AGENT_KEY): void {
		const trimmedKey = key.trim() || DEFAULT_ACTIVE_AGENT_KEY;
		const trimmedAgentId = agentId.trim();
		if (!trimmedAgentId) return;

		this.state = {
			schemaVersion: RESIDENT_CORE_STATE_VERSION,
			activeAgentKey: trimmedKey,
			agents: {
				...this.state.agents,
				[trimmedKey]: {
					agentId: trimmedAgentId,
					lastUsedAt: new Date().toISOString(),
				},
			},
		};
		writeResidentCoreState(this.userDataPath, this.state);
	}
}

export function createResidentCoreStateStore(userDataPath = app.getPath("userData")): ResidentCoreStateStore {
	return new ResidentCoreStateStore(userDataPath);
}
