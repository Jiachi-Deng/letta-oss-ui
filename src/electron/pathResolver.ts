import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

function getAppRootPath(): string {
    return app.getAppPath();
}

function getResourcesRootPath(): string {
    return process.resourcesPath;
}

function resolveFirstExistingPath(description: string, candidates: string[]): string {
    const resolvedPath = candidates.find((candidate) => existsSync(candidate));

    if (!resolvedPath) {
        throw new Error(`Could not resolve ${description}. Tried: ${candidates.join(", ")}`);
    }

    return resolvedPath;
}

export function getPreloadPath(): string {
    const appRootPath = getAppRootPath();

    if (!app.isPackaged) {
        return path.join(appRootPath, "dist-electron", "preload.cjs");
    }

    return resolveFirstExistingPath("preload script", [
        path.join(getResourcesRootPath(), "dist-electron", "preload.cjs"),
        path.join(appRootPath, "dist-electron", "preload.cjs"),
        path.join(getResourcesRootPath(), "preload.cjs"),
    ]);
}

export function getUIPath(): string {
    const appRootPath = getAppRootPath();

    return resolveFirstExistingPath("renderer entrypoint", [
        path.join(appRootPath, "dist-react", "index.html"),
        path.join(getResourcesRootPath(), "dist-react", "index.html"),
    ]);
}

export function getIconPath(): string {
    const appRootPath = getAppRootPath();

    return resolveFirstExistingPath("application icon", [
        path.join(getResourcesRootPath(), "templateIcon.png"),
        path.join(appRootPath, "templateIcon.png"),
    ]);
}
