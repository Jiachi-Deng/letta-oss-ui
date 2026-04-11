import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const sourceDist = resolve(appRoot, "../../vendor/lettabot/dist");
const targetDist = resolve(appRoot, "node_modules/lettabot/dist");
const nestedSdkCopy = resolve(appRoot, "node_modules/lettabot/node_modules/@letta-ai/letta-code-sdk");
const nestedCliCopy = resolve(appRoot, "node_modules/lettabot/node_modules/@letta-ai/letta-code");

if (!existsSync(sourceDist)) {
	throw new Error(`Expected lettabot build output at ${sourceDist}`);
}

mkdirSync(dirname(targetDist), { recursive: true });

if (existsSync(targetDist)) {
	const sourceReal = realpathSync(sourceDist);
	const targetReal = realpathSync(targetDist);
	if (sourceReal === targetReal) {
		rmSync(nestedSdkCopy, { recursive: true, force: true });
		rmSync(nestedCliCopy, { recursive: true, force: true });
		console.log(`[sync-lettabot] removed nested SDK copy ${nestedSdkCopy}`);
		console.log(`[sync-lettabot] removed nested CLI copy ${nestedCliCopy}`);
		process.exit(0);
	}
	rmSync(targetDist, { recursive: true, force: true });
} else if (lstatSync(dirname(targetDist)).isDirectory()) {
	// parent already ensured above; fall through to symlink creation
}

symlinkSync(sourceDist, targetDist, "dir");

rmSync(nestedSdkCopy, { recursive: true, force: true });
rmSync(nestedCliCopy, { recursive: true, force: true });
console.log(`[sync-lettabot] removed nested SDK copy ${nestedSdkCopy}`);
console.log(`[sync-lettabot] removed nested CLI copy ${nestedCliCopy}`);
