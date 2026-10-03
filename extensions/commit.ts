import os from "node:os";
import { readConfig } from "./config.ts";
import { ensureFilter, refreshMachineSidecar } from "./filter.ts";
import { git } from "./git.ts";
import { ensureAttributes, ensureIgnoreRules, ensureInfoExclude } from "./ignore.ts";
import {
	allowedRoots,
	stagedSecretFiles,
	untrackedNestedRepos,
} from "./protect.ts";
import type { Ctx, Deps } from "./types.ts";
import { dirOf } from "./util.ts";

export async function prepareCommit(deps?: Deps, ctx?: Ctx) {
	const config = await readConfig(deps, ctx),
		dir = dirOf(deps);
	await ensureIgnoreRules(dir, config);
	await ensureInfoExclude(dir);
	await ensureAttributes(dir);
	await ensureFilter(dir, config, ctx, deps);
	await refreshMachineSidecar(dir, config);
	return config;
}

export async function commitLocalChanges(
	deps?: Deps,
	commitMessage?: string,
	ctx?: Ctx,
) {
	const dir = dirOf(deps);
	await prepareCommit(deps, ctx);
	const status = (await git(["status", "--porcelain"], dir)).stdout.trim();
	if (!status) return false;
	const skipped = await untrackedNestedRepos(
		dir,
		allowedRoots(await readConfig(deps, ctx)),
	);
	await git(
		["add", "-A", "--", ".", ...skipped.map((entry) => `:(exclude)${entry}`)],
		dir,
	);
	const bad = await stagedSecretFiles(dir);
	if (bad.length) {
		await git(["reset"], dir);
		throw new Error(
			`REFUSED to commit sensitive paths: ${bad.join(", ")}. Remove with git rm --cached <file>.`,
		);
	}
	if (!(await git(["diff", "--cached", "--name-only"], dir)).stdout.trim())
		return false;
	const config = await readConfig(deps, ctx);
	const suffix =
		config.includeHostname === false ? "" : ` from ${os.hostname()}`;
	await git(
		["commit", "-m", commitMessage ?? `pi config: auto-sync${suffix}`],
		dir,
	);
	return true;
}
