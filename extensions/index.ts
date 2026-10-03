import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runInit, runLink, showStatus } from "./commands.ts";
import { commitLocalChanges, prepareCommit } from "./commit.ts";
import { isSyncableRepo } from "./git.ts";
import { bestEffortPush } from "./push.ts";
import { shouldAutoSync, withLock, writeState } from "./state.ts";
import { runSync } from "./sync.ts";
import { isSubagentChild, message, notify } from "./util.ts";

export * from "./commands.ts";
export * from "./commit.ts";
export * from "./config.ts";
export * from "./constants.ts";
export * from "./deny.ts";
export * from "./filter.ts";
export * from "./git.ts";
export * from "./ignore.ts";
export * from "./protect.ts";
export * from "./push.ts";
export * from "./repo.ts";
export * from "./state.ts";
export * from "./sync.ts";
export * from "./types.ts";
export * from "./util.ts";

export default function gitSync(pi: ExtensionAPI) {
	pi.registerCommand("gitsync", {
		description:
			"Securely sync pi config (init, link, status, sync, push, pull)",
		getArgumentCompletions: (prefix) => {
			const entries = ["init", "link", "status", "sync", "push", "pull"]
				.map((value) => ({ value, label: value }))
				.filter((x) => x.value.startsWith(prefix.trim()));
			return entries.length ? entries : null;
		},
		handler: async (args, ctx) => {
			const [command = "status", ...rest] = args.trim().split(/\s+/);
			const arg = rest.join(" ");
			try {
				await withLock(ctx, async () => {
					if (command === "init") return runInit(arg, ctx);
					if (command === "link") return runLink(arg, ctx);
					if (command === "status") return showStatus(ctx);
					if (command === "sync")
						return runSync(ctx, { auto: false, push: true });
					if (command === "push")
						return runSync(ctx, { auto: false, push: true, skipPull: true });
					if (command === "pull")
						return runSync(ctx, { auto: false, push: false });
					throw new Error(
						"Unknown command. Usage: /gitsync [init|link|status|sync|push|pull]",
					);
				});
			} catch (error) {
				notify(ctx, `git-sync: ${message(error)}`, "error");
			}
		},
	});
	pi.on("session_start", async (_event, ctx) => {
		if (await shouldAutoSync())
			try {
				await withLock(ctx, async () => {
					await writeState({ lastAutoSyncAt: new Date().toISOString() });
					await runSync(ctx, { auto: true, push: true });
				});
			} catch (error) {
				notify(ctx, `git-sync skipped: ${message(error)}`, "warning");
			}
	});
	pi.on("session_shutdown", async (event, ctx) => {
		const reason =
			typeof event === "object" && event
				? (event as { reason?: string }).reason
				: undefined;
		if (reason === "reload" || isSubagentChild() || !(await isSyncableRepo()))
			return;
		try {
			await withLock(ctx, async () => {
				await prepareCommit(undefined, ctx);
				await commitLocalChanges(undefined, undefined, ctx);
				await bestEffortPush();
			});
		} catch { }
	});
}
