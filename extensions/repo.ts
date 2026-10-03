import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { readConfig } from "./config.ts";
import { git, gitRaw, hasDotGit } from "./git.ts";
import type { Ctx, Deps, GhClient } from "./types.ts";
import { dirOf, notify } from "./util.ts";

const exec = promisify(execFile);

export function parseRepoReference(input: string, fallbackOwner: string) {
	const raw = input.trim().replace(/\.git$/i, "");
	if (!raw) return undefined;
	const ssh = raw.match(/^git@github\.com:([^/\s]+)\/([^/\s]+)$/i);
	if (ssh) return { owner: ssh[1]!, name: ssh[2]! };
	try {
		const url = new URL(raw);
		if (
			["github.com", "www.github.com"].includes(url.hostname) &&
			url.pathname.split("/").filter(Boolean).length === 2
		) {
			const [owner, name] = url.pathname.split("/").filter(Boolean);
			return { owner: owner!, name: name!.replace(/\.git$/i, "") };
		}
	} catch { }
	const bits = raw.split("/").filter(Boolean);
	if (bits.length === 1) return { owner: fallbackOwner, name: bits[0]! };
	if (bits.length === 2 && !raw.includes(":"))
		return { owner: bits[0]!, name: bits[1]! };
	return undefined;
}

export function remoteFromArg(arg: string, fallback: string) {
	if (
		/^(https?|ssh):\/\//.test(arg) ||
		/^git@/.test(arg) ||
		arg.startsWith("/") ||
		arg.startsWith(".")
	)
		return arg;
	const ref = parseRepoReference(arg, fallback);
	return ref ? `https://github.com/${ref.owner}/${ref.name}.git` : undefined;
}

export const defaultGh: GhClient = {
	async available() {
		try {
			await exec("gh", ["auth", "status"], { timeout: 5000 });
			return true;
		} catch {
			return false;
		}
	},
	async currentUser() {
		return (await exec("gh", ["api", "user", "--jq", ".login"])).stdout.trim();
	},
	async repoExists(id) {
		try {
			await exec("gh", ["repo", "view", id, "--json", "name"]);
			return true;
		} catch {
			return false;
		}
	},
	async isPrivate(id) {
		try {
			const { stdout } = await exec("gh", [
				"repo",
				"view",
				id,
				"--json",
				"isPrivate",
			]);
			return (JSON.parse(stdout) as { isPrivate: boolean }).isPrivate;
		} catch {
			return undefined;
		}
	},
	async createPrivateRepo(id) {
		await exec("gh", ["repo", "create", id, "--private"], { timeout: 15_000 });
	},
	remoteUrl(id) {
		return `https://github.com/${id}.git`;
	},
};

export async function addRemote(url: string, dir: string) {
	await git(["remote", "add", "origin", url], dir);
}

export async function initRepo(dir: string) {
	if (!(await hasDotGit(dir))) await git(["init", "-b", "main"], dir);
}

export async function warnPublic(ctx: Ctx | undefined, deps?: Deps) {
	const dir = dirOf(deps),
		config = await readConfig(deps, ctx);
	if (config.warnOnPublicRemote === false) return;
	const gh = deps?.gh ?? defaultGh;
	if (!(await gh.available())) return;
	try {
		const remote = (
			await git(["remote", "get-url", "origin"], dir)
		).stdout.trim();
		const ref = parseRepoReference(remote, "");
		if (ref && (await gh.isPrivate(`${ref.owner}/${ref.name}`)) === false)
			notify(
				ctx,
				"git-sync: remote is PUBLIC — pi-config-sync never syncs secrets, but review what you allowlist; silence with warnOnPublicRemote: false in git-sync.jsonc",
				"warning",
				deps,
			);
	} catch { }
}

export async function defaultBranch(dir: string) {
	try {
		const { stdout } = await git(
			["ls-remote", "--symref", "origin", "HEAD"],
			dir,
		);
		const found = stdout.match(/ref: refs\/heads\/([^\s]+)\s+HEAD/);
		return found?.[1] ?? "main";
	} catch {
		return "main";
	}
}

export async function backupConflicts(dir: string, branch: string) {
	const { stdout } = await git(
		["ls-tree", "-r", "--name-only", "-z", `origin/${branch}`],
		dir,
	);
	const backups: string[] = [];
	for (const relative of stdout.split("\0").filter(Boolean)) {
		const target = path.join(dir, relative);
		try {
			await fs.lstat(target);
		} catch {
			continue;
		}
		const local = await fs.readFile(target).catch(() => undefined);
		const remote = await gitRaw(["show", `origin/${branch}:${relative}`], dir)
			.then((x) => x.stdout)
			.catch(() => undefined);
		if (local && remote && !local.equals(remote)) {
			await fs.rename(target, `${target}.local-backup`);
			backups.push(relative);
		}
	}
	return backups;
}
