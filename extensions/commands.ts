import fs from "node:fs/promises";
import path from "node:path";
import { LIKELY_SYNC_REPO_NAMES } from "./constants.ts";
import { readConfig } from "./config.ts";
import { commitLocalChanges } from "./commit.ts";
import { isDenied } from "./deny.ts";
import { ensureFilter, refreshMachineSidecar } from "./filter.ts";
import {
	git,
	hasCommits,
	hasDotGit,
	isSyncableRepo,
} from "./git.ts";
import { ensureAttributes, ensureIgnoreRules, ensureInfoExclude } from "./ignore.ts";
import { gapMessages, syncGaps, trackedSecretFiles } from "./protect.ts";
import { push } from "./push.ts";
import {
	addRemote,
	backupConflicts,
	defaultBranch,
	defaultGh,
	initRepo,
	parseRepoReference,
	remoteFromArg,
	warnPublic,
} from "./repo.ts";
import type { Ctx, Deps } from "./types.ts";
import { dirOf, message, notify } from "./util.ts";

export async function runInit(arg: string, ctx?: Ctx, deps?: Deps) {
	const dir = dirOf(deps);
	await fs.mkdir(dir, { recursive: true });
	if (await isSyncableRepo(dir))
		throw new Error("already initialized; use /gitsync sync");
	const config = await readConfig(deps, ctx);
	await ensureIgnoreRules(dir, config);
	await initRepo(dir);
	await ensureInfoExclude(dir);
	const tracked = await trackedSecretFiles(dir);
	if (tracked.length)
		throw new Error(
			`tracked sensitive files: ${tracked.join(", ")}. Remove with git rm --cached <file>.`,
		);
	await commitLocalChanges(deps, "pi config: initial sync setup", ctx);
	let remote = remoteFromArg(arg, "");
	if (!remote) {
		const gh = deps?.gh ?? defaultGh;
		if (!(await gh.available())) {
			notify(
				ctx,
				"git-sync: initial commit created. Create a private repo, then run /gitsync init <url>.",
				"warning",
				deps,
			);
			return;
		}
		const owner = await gh.currentUser();
		const ref = parseRepoReference(arg || "pi-agent-config", owner);
		if (!ref) throw new Error(`invalid repository reference: ${arg}`);
		const id = `${ref.owner}/${ref.name}`;
		if (await gh.repoExists(id))
			throw new Error("repository already exists; use /gitsync link instead");
		await gh.createPrivateRepo(id);
		remote = gh.remoteUrl(id);
	}
	await addRemote(remote, dir);
	if (!(await push(true, dir))) throw new Error("initial push failed");
	await warnPublic(ctx, deps);
	notify(
		ctx,
		"git-sync: initialized and pushed private config repo.",
		"info",
		deps,
	);
}

export async function runLink(arg: string, ctx?: Ctx, deps?: Deps) {
	const dir = dirOf(deps);
	if (await isSyncableRepo(dir))
		throw new Error("already linked; use /gitsync sync");
	const gh = deps?.gh ?? defaultGh;
	let remote = remoteFromArg(arg, "");
	if (!remote) {
		if (!(await gh.available())) {
			notify(
				ctx,
				"git-sync: provide a repo URL, or install and authenticate gh.",
				"warning",
				deps,
			);
			return;
		}
		const owner = await gh.currentUser();
		for (const name of LIKELY_SYNC_REPO_NAMES)
			if (await gh.repoExists(`${owner}/${name}`)) {
				remote = gh.remoteUrl(`${owner}/${name}`);
				break;
			}
		if (!remote) throw new Error("no sync repository found; provide its URL");
	}
	await fs.mkdir(dir, { recursive: true });
	if ((await hasDotGit(dir)) && (await hasCommits(dir)))
		throw new Error(
			`existing git history in ${dir} has no 'origin' remote; push or back it up (or remove ${path.join(dir, ".git")}) before linking`,
		);
	const config = await readConfig(deps, ctx);
	await initRepo(dir);
	await ensureIgnoreRules(dir, config);
	await ensureInfoExclude(dir);
	await ensureAttributes(dir);
	await ensureFilter(dir, config, ctx, deps);
	await refreshMachineSidecar(dir, config);
	await addRemote(remote, dir);
	await git(["fetch", "origin"], dir);
	const branch = await defaultBranch(dir);
	const backups = await backupConflicts(dir, branch);
	try {
		await git(["checkout", "-B", branch, `origin/${branch}`], dir);
	} catch (error) {
		const output = message(error);
		const refused =
			output
				.match(
					/would be overwritten by checkout:\n([\s\S]*?)Please move or remove/,
				)?.[1]
				?.split("\n")
				.map((line) => line.trim())
				.filter(Boolean) ?? [];
		for (const relative of refused) {
			if (isDenied(relative)) continue;
			const target = path.join(dir, relative);
			try {
				await fs.rename(target, `${target}.local-backup`);
				backups.push(relative);
			} catch { }
		}
		if (refused.length) {
			try {
				await git(["checkout", "-B", branch, `origin/${branch}`], dir);
			} catch (retry) {
				throw new Error(`${message(retry)}\nResolve manually in ${dir}`);
			}
		} else throw new Error(`${output}\nResolve manually in ${dir}`);
	}
	const tracked = await trackedSecretFiles(dir);
	if (tracked.length)
		notify(
			ctx,
			`git-sync: remote tracks sensitive files: ${tracked.join(", ")}. Remove with git rm --cached <file>.`,
			"warning",
			deps,
		);
	await warnPublic(ctx, deps);
	notify(
		ctx,
		`git-sync: linked — run /reload to apply pulled config.${backups.length ? ` Backed up: ${backups.join(", ")}.` : ""}`,
		"info",
		deps,
	);
}

export async function showStatus(ctx: Ctx, deps?: Deps) {
	const dir = dirOf(deps);
	if (!(await isSyncableRepo(dir))) {
		notify(
			ctx,
			`git-sync: ${dir} is not initialized. Run /gitsync init.`,
			"warning",
			deps,
		);
		return;
	}
	const branch = (
		await git(["rev-parse", "--abbrev-ref", "HEAD"], dir)
	).stdout.trim();
	const dirty = (await git(["status", "--porcelain"], dir)).stdout.trim();
	const bad = await trackedSecretFiles(dir),
		gaps = gapMessages(await syncGaps(dir, await readConfig(deps, ctx)));
	notify(
		ctx,
		`repo: ${dir}\nbranch: ${branch}\nuncommitted changes: ${dirty ? "yes" : "none"}${bad.length ? `\nWARNING tracked sensitive files: ${bad.join(", ")}` : ""}${gaps.map((line) => `\nWARNING ${line}`).join("")}`,
		bad.length || gaps.length ? "warning" : "info",
		deps,
	);
	await warnPublic(ctx, deps);
}
