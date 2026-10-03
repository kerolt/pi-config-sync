import fs from "node:fs/promises";
import path from "node:path";
import { machineKeys } from "./config.ts";
import { git, gitConfigValue, hasDotGit } from "./git.ts";
import type { Ctx, Deps, GitSyncConfig, Runtime } from "./types.ts";
import { dirOf, stateDir, warnOnce } from "./util.ts";

function filterSource(keys: string[]) {
	return `import fs from "node:fs";
const keys=${JSON.stringify(keys)};
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk); const raw=Buffer.concat(chunks);
try { const value=JSON.parse(raw.toString("utf8")); if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("not object"); if (process.argv[2] === "clean") { for (const key of keys) delete value[key]; process.stdout.write(JSON.stringify(value, null, 2)+"\\n"); } else if (process.argv[2] === "smudge") { const sidecar=JSON.parse(fs.readFileSync(new URL("settings.machine.json", import.meta.url), "utf8")); if (!sidecar || Array.isArray(sidecar) || typeof sidecar !== "object") throw new Error("bad sidecar"); process.stdout.write(JSON.stringify({...value, ...sidecar}, null, 2)+"\\n"); } else process.stdout.write(raw); } catch { process.stdout.write(raw); }
`;
}

/** pi shipped as a single executable (Node SEA or compiled Bun binary): process.execPath is pi itself and cannot run the filter script. */
export async function detectRuntime(): Promise<Runtime> {
	const execPath = process.execPath;
	if (process.versions.bun)
		return { bundled: !/^bun/i.test(path.basename(execPath)), execPath };
	try {
		return { bundled: (await import("node:sea")).isSea(), execPath };
	} catch {
		return { bundled: false, execPath };
	}
}

export async function findOnPath(
	name: string,
	pathEnv = process.env.PATH ?? "",
	platform = process.platform,
) {
	const names =
		platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];
	for (const directory of pathEnv.split(path.delimiter).filter(Boolean))
		for (const candidate of names) {
			const full = path.join(directory, candidate);
			try {
				await fs.access(full, fs.constants.X_OK);
				return full;
			} catch { }
		}
	return undefined;
}

export async function filterInterpreter(
	config: GitSyncConfig,
	runtime: Runtime,
	ctx?: Ctx,
	deps?: Deps,
) {
	if (config.nodePath) return config.nodePath;
	if (!runtime.bundled) return runtime.execPath;
	const found = await findOnPath("node", runtime.pathEnv, runtime.platform);
	if (found) return found;
	warnOnce(
		ctx,
		"git-sync: pi runs as a bundled executable and no node was found on PATH; settings.json filter is disabled until nodePath is set in git-sync.jsonc",
		deps,
		"nodePath",
	);
	return "node";
}

export async function ensureFilter(
	dir = dirOf(),
	config: GitSyncConfig = {},
	ctx?: Ctx,
	deps?: Deps,
) {
	if (!(await hasDotGit(dir))) return;
	await fs.mkdir(stateDir(dir), { recursive: true });
	const script = path.join(stateDir(dir), "filter.mjs"),
		source = filterSource(machineKeys(config));
	try {
		if ((await fs.readFile(script, "utf8")) !== source)
			await fs.writeFile(script, source);
	} catch {
		await fs.writeFile(script, source);
	}
	const interpreter = await filterInterpreter(
		config,
		deps?.runtime ?? (await detectRuntime()),
		ctx,
		deps,
	);
	const quoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
	const values: Record<string, string> = {
		"filter.pi-config-sync.clean": `${quoted(interpreter)} ${quoted(script)} clean`,
		"filter.pi-config-sync.smudge": `${quoted(interpreter)} ${quoted(script)} smudge`,
		"filter.pi-config-sync.required": "false",
	};
	let configured = false;
	for (const [key, value] of Object.entries(values))
		if ((await gitConfigValue(key, dir)) !== value) {
			await git(["config", key, value], dir);
			configured = true;
		}
	if (configured)
		try {
			await git(["add", "--renormalize", "settings.json"], dir);
		} catch { }
}

export async function refreshMachineSidecar(
	dir = dirOf(),
	config: GitSyncConfig = {},
) {
	try {
		const settings = JSON.parse(
			await fs.readFile(path.join(dir, "settings.json"), "utf8"),
		) as Record<string, unknown>;
		if (!settings || Array.isArray(settings) || typeof settings !== "object")
			return;
		const sidecar = Object.fromEntries(
			machineKeys(config)
				.filter((key) => Object.hasOwn(settings, key))
				.map((key) => [key, settings[key]]),
		);
		const output = JSON.stringify(sidecar, null, 2) + "\n",
			file = path.join(stateDir(dir), "settings.machine.json");
		await fs.mkdir(stateDir(dir), { recursive: true });
		try {
			if ((await fs.readFile(file, "utf8")) === output) return;
		} catch { }
		await fs.writeFile(file, output);
	} catch { }
}
