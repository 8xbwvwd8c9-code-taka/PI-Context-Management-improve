/**
 * P01 pilot constants. Single source of truth for the Pi
 * version pinned by the pilot; matches
 * package.json peerDependencies.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

function readPiVersion(): string {
	const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
		packages?: Record<string, { version?: string }>;
	};
	const pkg = lock.packages?.["node_modules/@earendil-works/pi-coding-agent"];
	return pkg?.version ?? "unknown";
}

export const PI_VERSION: string = readPiVersion();
