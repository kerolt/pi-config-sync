import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MACHINE_LOCAL } from "./constants.ts";
import { validExtra } from "./deny.ts";
import type { Ctx, Deps, GitSyncConfig } from "./types.ts";
import { dirOf, warnOnce } from "./util.ts";

export function stripJsonComments(input: string) {
	let out = "",
		quote = "",
		escaped = false;
	for (let i = 0; i < input.length; i++) {
		const c = input[i]!,
			next = input[i + 1];
		if (quote) {
			out += c;
			if (escaped) escaped = false;
			else if (c === "\\") escaped = true;
			else if (c === quote) quote = "";
			continue;
		}
		if (c === '"' || c === "'") {
			quote = c;
			out += c;
		} else if (c === "/" && next === "/") {
			while (i < input.length && input[i] !== "\n") i++;
			out += "\n";
		} else if (c === "/" && next === "*") {
			i += 2;
			while (i < input.length && !(input[i] === "*" && input[i + 1] === "/"))
				i++;
			i++;
		} else out += c;
	}
	return out;
}

export function machineKeys(config: GitSyncConfig) {
	return config.machineLocalSettings ?? DEFAULT_MACHINE_LOCAL;
}

export async function readConfig(
	deps?: Deps,
	ctx?: Ctx,
): Promise<GitSyncConfig> {
	const dir = dirOf(deps);
	try {
		const raw = JSON.parse(
			stripJsonComments(
				await fs.readFile(path.join(dir, "git-sync.jsonc"), "utf8"),
			),
		) as GitSyncConfig;
		const extras = (raw.extraPaths ?? []).filter(validExtra);
		if (extras.length !== (raw.extraPaths ?? []).length)
			warnOnce(
				ctx,
				"git-sync: unsafe extraPaths were ignored",
				deps,
				`${dir}|extras`,
			);
		let machineLocalSettings: string[] | undefined;
		if (Array.isArray(raw.machineLocalSettings)) {
			machineLocalSettings = raw.machineLocalSettings.filter(
				(key): key is string => typeof key === "string" && key.trim() !== "",
			);
			if (machineLocalSettings.length !== raw.machineLocalSettings.length)
				warnOnce(
					ctx,
					"git-sync: invalid machineLocalSettings entries were ignored",
					deps,
					`${dir}|machineKeys`,
				);
		}
		let nodePath: string | undefined;
		if (raw.nodePath !== undefined) {
			if (typeof raw.nodePath === "string" && raw.nodePath.trim() !== "")
				nodePath = raw.nodePath.trim();
			else
				warnOnce(
					ctx,
					"git-sync: invalid nodePath was ignored",
					deps,
					`${dir}|nodePath`,
				);
		}
		return { ...raw, extraPaths: extras, machineLocalSettings, nodePath };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		warnOnce(
			ctx,
			"git-sync: invalid git-sync.jsonc; using defaults",
			deps,
			`${dir}|invalid`,
		);
		return {};
	}
}
