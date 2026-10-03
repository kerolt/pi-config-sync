import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PATHS, RUNTIME_LOG_DIR } from "./constants.ts";
import { isDenied, validExtra } from "./deny.ts";
import { git, statusEntries } from "./git.ts";
import type { GitSyncConfig } from "./types.ts";
import { dirOf } from "./util.ts";

export async function stagedSecretFiles(dir = dirOf()) {
	const { stdout } = await git(
		["diff", "--cached", "--name-only", "--diff-filter=d", "-z"],
		dir,
	);
	return stdout.split("\0").filter(Boolean).filter(isDenied);
}

export function allowedRoots(config: GitSyncConfig) {
	return new Set(
		[...DEFAULT_PATHS, ...(config.extraPaths ?? []).filter(validExtra)].map(
			(entry) => entry.split("/").filter(Boolean)[0]!,
		),
	);
}

function inAllowedRoot(file: string, roots: Set<string>) {
	const parts = file.split("/").filter(Boolean);
	return (
		parts.length >= 2 &&
		roots.has(parts[0]!) &&
		!parts.includes("node_modules") &&
		!parts.includes(RUNTIME_LOG_DIR) &&
		!parts.includes(".DS_Store")
	);
}

/** Untracked directories inside allowed roots that are git repositories themselves. They are excluded from staging: a gitlink pointer is useless on other machines, and one without commits makes git add fail. */
export async function untrackedNestedRepos(dir: string, roots: Set<string>) {
	const found: string[] = [];
	try {
		for (const { code, file } of await statusEntries(dir, [
			"--untracked-files=all",
		]))
			if (code === "??" && file.endsWith("/") && inAllowedRoot(file, roots)) {
				try {
					await fs.access(path.join(dir, file, ".git"));
					found.push(file.replace(/\/$/, ""));
				} catch { }
			}
	} catch { }
	return found;
}

/** Allowlisted content that will not sync: nested repositories (skipped, or a legacy pointer) and names caught by the secret denylist. */
export async function syncGaps(dir = dirOf(), config: GitSyncConfig = {}) {
	const roots = allowedRoots(config),
		nested = new Set(await untrackedNestedRepos(dir, roots)),
		denied: string[] = [];
	try {
		for (const entry of (await git(["ls-files", "-s", "-z"], dir)).stdout
			.split("\0")
			.filter(Boolean)) {
			const [meta, file] = entry.split("\t");
			if (meta?.startsWith("160000") && file) nested.add(file);
		}
	} catch { }
	try {
		for (const { code, file } of await statusEntries(dir, ["--ignored"]))
			if (code === "!!" && inAllowedRoot(file, roots) && isDenied(file))
				denied.push(file);
	} catch { }
	return { denied, nested: [...nested].sort() };
}

export function gapMessages(gaps: { denied: string[]; nested: string[] }) {
	const lines: string[] = [];
	if (gaps.nested.length)
		lines.push(
			`nested git repositories are skipped: ${gaps.nested.join(", ")}. Remove the inner .git directory to sync them.`,
		);
	if (gaps.denied.length)
		lines.push(
			`allowlisted paths skipped because their name looks sensitive: ${gaps.denied.join(", ")}. Rename them to sync.`,
		);
	return lines;
}

export async function trackedSecretFiles(dir = dirOf()) {
	try {
		const { stdout } = await git(["ls-files", "-z"], dir);
		return stdout.split("\0").filter(Boolean).filter(isDenied);
	} catch {
		return [];
	}
}
