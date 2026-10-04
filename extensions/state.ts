import fs from "node:fs/promises";
import { readConfig } from "./config.ts";
import { isSyncableRepo } from "./git.ts";
import type { Ctx, Deps } from "./types.ts";
import {
	dirOf,
	isSubagentChild,
	lockPath,
	stateDir,
	statePath,
} from "./util.ts";

async function readState(dir: string) {
	try {
		return JSON.parse(await fs.readFile(statePath(dir), "utf8")) as {
			lastAutoSyncAt?: string;
		};
	} catch {
		return {};
	}
}

export async function writeState(state: { lastAutoSyncAt: string }, dir = dirOf()) {
	await fs.mkdir(stateDir(dir), { recursive: true });
	await fs.writeFile(statePath(dir), JSON.stringify(state));
}

export async function shouldAutoSync(deps?: Deps) {
	const dir = dirOf(deps);
	if (isSubagentChild() || !(await isSyncableRepo(dir))) return false;
	const config = await readConfig(deps);
	if (config.autoSyncOnSessionStart === false) return false;
	const state = await readState(dir);
	if (!state.lastAutoSyncAt) return true;
	return (
		Date.now() - Date.parse(state.lastAutoSyncAt) >=
		(config.autoSyncIntervalMinutes ?? 5) * 60_000
	);
}

export async function withLock<T>(
	ctx: Ctx | undefined,
	fn: () => Promise<T>,
	deps?: Deps,
): Promise<T | undefined> {
	const dir = dirOf(deps);
	await fs.mkdir(stateDir(dir), { recursive: true });
	try {
		const handle = await fs.open(lockPath(dir), "wx");
		await handle.writeFile(
			JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
		);
		await handle.close();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		try {
			const lock = JSON.parse(await fs.readFile(lockPath(dir), "utf8")) as {
				pid: number;
				startedAt: string;
			};
			if (Number.isInteger(lock.pid) && lock.pid > 0) {
				process.kill(lock.pid, 0);
				if (Date.now() - Date.parse(lock.startedAt) < 600_000) return undefined;
			}
		} catch { }
		await fs.rm(lockPath(dir), { force: true });
		return withLock(ctx, fn, deps);
	}
	try {
		return await fn();
	} finally {
		await fs.rm(lockPath(dir), { force: true });
	}
}
