import os from "node:os";
import path from "node:path";
import type { Ctx, Deps, Level } from "./types.ts";

export function dirOf(deps?: Deps) {
	const value = deps?.dir ?? process.env.PI_CODING_AGENT_DIR?.trim();
	return !value
		? path.join(os.homedir(), ".pi", "agent")
		: value === "~" || value.startsWith("~/")
			? path.join(os.homedir(), value.slice(2))
			: path.resolve(value);
}

export function notify(ctx: Ctx | undefined, text: string, level: Level, deps?: Deps) {
	if (deps?.notify) deps.notify(text, level);
	else if (ctx?.hasUI) ctx.ui.notify(text, level);
}

const warnedOnce = new Set<string>();

export function warnOnce(
	ctx: Ctx | undefined,
	text: string,
	deps: Deps | undefined,
	key = text,
) {
	if (warnedOnce.has(key) || !(deps?.notify || ctx?.hasUI)) return;
	warnedOnce.add(key);
	notify(ctx, text, "warning", deps);
}

export function message(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export function stateDir(dir: string) {
	return path.join(dir, ".git-sync");
}

export function statePath(dir: string) {
	return path.join(stateDir(dir), "state.json");
}

export function lockPath(dir: string) {
	return path.join(stateDir(dir), "lock");
}

export function isSubagentChild() {
	return Number(process.env.PI_SUBAGENT_DEPTH ?? "0") > 0;
}
