import fs from "node:fs/promises";
import path from "node:path";
import {
	DEFAULT_PATHS,
	END,
	IGNORE_DENY,
	LEGACY_MARKERS,
	START,
} from "./constants.ts";
import { validExtra } from "./deny.ts";
import type { GitSyncConfig } from "./types.ts";
import { dirOf } from "./util.ts";

function allowRules(entry: string) {
	const segments = entry.replace(/\/+$/, "").split("/").filter(Boolean);
	const rules: string[] = [];
	let prefix = "";
	for (let i = 0; i < segments.length; i++) {
		prefix = prefix ? `${prefix}/${segments[i]}` : segments[i]!;
		if (i < segments.length - 1) rules.push(`!${prefix}/`);
		else rules.push(`!${prefix}`, `!${prefix}/`, `!${prefix}/**`);
	}
	return rules;
}

export async function ensureIgnoreRules(
	dir = dirOf(),
	config: GitSyncConfig = {},
) {
	const file = path.join(dir, ".gitignore");
	let existing = "";
	try {
		existing = await fs.readFile(file, "utf8");
	} catch { }
	const paths = [
		...DEFAULT_PATHS,
		...(config.extraPaths ?? []).filter(validExtra),
	];
	const lines = [
		START,
		"*",
		...paths.flatMap(allowRules),
		"# hard denylist — re-ignored even inside allowed dirs",
		...IGNORE_DENY,
		END,
	];
	const block = lines.join("\n");
	let base = existing,
		replaced = false;
	for (const [start, end] of [
		[START, END] as [string, string],
		...LEGACY_MARKERS,
	]) {
		const re = new RegExp(
			`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`,
		);
		if (re.test(base)) {
			base = base.replace(re, "");
			replaced = true;
		}
	}
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(
		file,
		(replaced ? base : base.replace(/\s*$/, "\n")) + block + "\n",
	);
}

export async function ensureInfoExclude(dir = dirOf()) {
	const file = path.join(dir, ".git", "info", "exclude");
	await fs.mkdir(path.dirname(file), { recursive: true });
	let current = "";
	try {
		current = await fs.readFile(file, "utf8");
	} catch { }
	const missing = IGNORE_DENY.filter(
		(rule) => !current.split("\n").includes(rule),
	);
	if (missing.length)
		await fs.writeFile(
			file,
			current.replace(/\s*$/, "\n") + missing.join("\n") + "\n",
		);
}

function escapeRegExp(text: string) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function ensureAttributes(dir = dirOf()) {
	const file = path.join(dir, ".gitattributes");
	let current = "";
	try {
		current = await fs.readFile(file, "utf8");
	} catch { }
	const line = "settings.json filter=pi-config-sync";
	if (!current.split(/\r?\n/).includes(line))
		await fs.writeFile(
			file,
			`${current.replace(/\s*$/, "")}\n${line}\n`.replace(/^\n/, ""),
		);
}
