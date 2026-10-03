import { isDenied } from "./deny.ts";
import { counts, git, upstreamRef } from "./git.ts";
import type { Deps } from "./types.ts";
import { dirOf } from "./util.ts";

async function assertSafeToPush(dir: string) {
	const tracked = (
		await git(["ls-tree", "-r", "--name-only", "-z", "HEAD"], dir)
	).stdout;
	const denied = new Set(tracked.split("\0").filter(Boolean).filter(isDenied));
	const commits = (
		await git(["rev-list", "HEAD", "--not", "--remotes=origin"], dir)
	).stdout
		.trim()
		.split("\n")
		.filter(Boolean);
	for (const commit of commits) {
		const changed = (
			await git(
				[
					"diff-tree",
					"--root",
					"-m",
					"-r",
					"--no-commit-id",
					"--no-renames",
					"--name-only",
					"--diff-filter=d",
					"-z",
					commit,
				],
				dir,
			)
		).stdout;
		for (const file of changed.split("\0").filter(Boolean).filter(isDenied))
			denied.add(file);
	}
	if (denied.size)
		throw new Error(
			`REFUSED to push denied paths in the current tree or outgoing history: ${[...denied].join(", ")}. Untrack current files and remove any unpushed commits containing them before retrying; local files are not deleted.`,
		);
}

export async function push(first: boolean, dir: string) {
	await assertSafeToPush(dir);
	try {
		await git(first ? ["push", "-u", "origin", "HEAD"] : ["push"], dir, 15_000);
		return true;
	} catch {
		return false;
	}
}

export async function bestEffortPush(deps?: Deps) {
	const dir = dirOf(deps);
	const upstream = await upstreamRef(dir);
	if (!upstream) return push(true, dir);
	const { ahead, behind } = await counts(upstream, dir);
	return ahead > 0 && behind === 0 ? push(false, dir) : false;
}
