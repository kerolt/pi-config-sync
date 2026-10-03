import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { dirOf } from "./util.ts";

const exec = promisify(execFile);

export function gitEnv(dir: string) {
	return {
		...process.env,
		GIT_TERMINAL_PROMPT: "0",
		GIT_CEILING_DIRECTORIES: path.dirname(dir),
	};
}

export function git(args: string[], dir: string, timeout = 10_000) {
	return exec("git", args, {
		cwd: dir,
		timeout,
		maxBuffer: 16 * 1024 * 1024,
		env: gitEnv(dir),
	});
}

export function gitRaw(args: string[], dir: string) {
	return exec("git", args, {
		cwd: dir,
		timeout: 10_000,
		maxBuffer: 64 * 1024 * 1024,
		encoding: "buffer",
		env: gitEnv(dir),
	}) as unknown as Promise<{ stdout: Buffer; stderr: Buffer }>;
}

export async function gitConfigValue(key: string, dir: string) {
	try {
		return (await git(["config", "--get", key], dir)).stdout.trim();
	} catch {
		return undefined;
	}
}

export async function statusEntries(dir: string, args: string[]) {
	return (await git(["status", "--porcelain", "-z", ...args], dir)).stdout
		.split("\0")
		.filter(Boolean)
		.map((entry) => ({ code: entry.slice(0, 2), file: entry.slice(3) }));
}

export async function hasDotGit(dir: string) {
	try {
		await fs.access(path.join(dir, ".git"));
		return true;
	} catch {
		return false;
	}
}

export async function hasCommits(dir: string) {
	try {
		await git(["rev-parse", "HEAD"], dir);
		return true;
	} catch {
		return false;
	}
}

export async function isSyncableRepo(dir = dirOf()) {
	if (!(await hasDotGit(dir))) return false;
	try {
		const { stdout } = await git(["remote"], dir);
		return stdout.split("\n").includes("origin");
	} catch {
		return false;
	}
}

export async function upstreamRef(dir: string) {
	try {
		return (
			await git(["rev-parse", "--abbrev-ref", "@{u}"], dir)
		).stdout.trim();
	} catch {
		return undefined;
	}
}

export async function counts(upstream: string, dir: string) {
	const { stdout } = await git(
		["rev-list", "--left-right", "--count", `${upstream}...HEAD`],
		dir,
	);
	const [behind = "0", ahead = "0"] = stdout.trim().split(/\s+/);
	return { behind: Number(behind), ahead: Number(ahead) };
}

export async function fetchOrigin(dir: string) {
	try {
		await git(["fetch", "origin"], dir);
		return true;
	} catch {
		return false;
	}
}

export async function integrate(upstream: string, dir: string) {
	try {
		await git(["merge", "--ff-only", upstream], dir);
		return true;
	} catch { }
	try {
		await git(["rebase", upstream], dir);
		return true;
	} catch {
		try {
			await git(["rebase", "--abort"], dir);
		} catch { }
		return false;
	}
}
