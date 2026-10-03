import { STATUS_KEY } from "./constants.ts";
import { readConfig } from "./config.ts";
import { commitLocalChanges, prepareCommit } from "./commit.ts";
import {
	fetchOrigin,
	counts,
	integrate,
	isSyncableRepo,
	upstreamRef,
} from "./git.ts";
import { gapMessages, syncGaps, trackedSecretFiles } from "./protect.ts";
import { push } from "./push.ts";
import type { Ctx, Deps } from "./types.ts";
import { dirOf, notify, warnOnce } from "./util.ts";

export async function runSync(
	ctx: Ctx | undefined,
	options: { auto: boolean; push: boolean; skipPull?: boolean },
	deps?: Deps,
) {
	const dir = dirOf(deps);
	if (!(await isSyncableRepo(dir))) {
		if (!options.auto)
			notify(
				ctx,
				`git-sync: no git repo with an 'origin' remote in ${dir}. Run /gitsync init.`,
				"warning",
				deps,
			);
		return;
	}
	if (ctx?.hasUI) ctx.ui.setStatus(STATUS_KEY, "syncing");
	try {
		await prepareCommit(deps, ctx);
		const tracked = await trackedSecretFiles(dir);
		if (tracked.length)
			notify(
				ctx,
				`git-sync: tracked sensitive files: ${tracked.join(", ")}. Remove with git rm --cached <file>.`,
				"warning",
				deps,
			);
		const changed: string[] = [];
		if (await commitLocalChanges(deps, undefined, ctx))
			changed.push("committed local changes");
		for (const line of gapMessages(
			await syncGaps(dir, await readConfig(deps, ctx)),
		))
			warnOnce(ctx, `git-sync: ${line}`, deps, `${dir}|${line}`);
		if (!options.skipPull) {
			if (!(await fetchOrigin(dir))) {
				if (!options.auto)
					notify(
						ctx,
						"git-sync: fetch failed; skipped pull/push.",
						"warning",
						deps,
					);
				return;
			}
			const upstream = await upstreamRef(dir);
			if (upstream && (await counts(upstream, dir)).behind > 0) {
				if (!(await integrate(upstream, dir)))
					throw new Error(
						`local and remote diverged with conflicts; rebase aborted in ${dir}`,
					);
				changed.push("pulled updates");
			}
		}
		if (options.push) {
			const upstream = await upstreamRef(dir);
			if (!upstream || (await counts(upstream, dir)).ahead > 0) {
				if (await push(!upstream, dir)) changed.push("pushed");
			}
		}
		if (changed.some((x) => x.startsWith("pulled")))
			notify(
				ctx,
				`git-sync: ${changed.join(", ")}. Run /reload to apply pulled config.`,
				"info",
				deps,
			);
		else if (!options.auto)
			notify(
				ctx,
				changed.length
					? `git-sync: ${changed.join(", ")}.`
					: "git-sync: already up to date.",
				"info",
				deps,
			);
	} finally {
		if (ctx?.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	}
}
