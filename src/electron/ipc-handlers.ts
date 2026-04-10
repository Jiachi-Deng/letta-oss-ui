import { BrowserWindow } from "electron";
import type { ClientEvent, ServerEvent } from "./types.js";
import type { ResidentCoreService } from "./libs/resident-core/resident-core.js";

let residentCore: ResidentCoreService | null = null;

export function bindResidentCoreService(service: ResidentCoreService): void {
	residentCore = service;
}

function broadcast(event: ServerEvent): void {
	const payload = JSON.stringify(event);
	const windows = BrowserWindow.getAllWindows();
	for (const win of windows) {
		win.webContents.send("server-event", payload);
	}
}

export async function handleClientEvent(event: ClientEvent): Promise<void> {
	if (!residentCore) {
		throw new Error("Resident Core service is not bound");
	}
	await residentCore.handleClientEvent(event);
}

export function cleanupAllSessions(): void {
	residentCore?.cleanupAllSessions();
}

export const residentCoreBroadcast = broadcast;
