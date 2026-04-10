import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const distRoot = path.join(appRoot, "dist-electron");

const stalePaths = [
    "ipc-handlers.js",
    "libs",
    "main.js",
    "pathResolver.js",
    "preload.cjs",
    "test.js",
    "types.js",
    "util.js",
];

for (const relativePath of stalePaths) {
    rmSync(path.join(distRoot, relativePath), { force: true, recursive: true });
}
