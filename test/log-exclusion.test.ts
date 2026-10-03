import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
	commitLocalChanges,
	ensureIgnoreRules,
	isDenied,
	runInit,
	runLink,
	runSync,
	syncGaps,
	type GhClient,
} from "../extensions/index.ts";

const exec = promisify(execFile);
const logFile =
	"extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl";
const debugFile =
	"extensions/pi-permission-system/logs/pi-permission-system-debug.jsonl";
const configFile = "extensions/pi-permission-system/config.json";
const gh: GhClient = {
	async available() {
		return false;
	},
	async currentUser() {
		throw new Error("Unexpected GitHub call");
	},
	async repoExists() {
		throw new Error("Unexpected GitHub call");
	},
	async isPrivate() {
		throw new Error("Unexpected GitHub call");
	},
	async createPrivateRepo() {
		throw new Error("Unexpected GitHub call");
	},
	remoteUrl() {
		throw new Error("Unexpected GitHub call");
	},
};

process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME =
	"pi-config-sync tests";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL =
	"tests@pi-config-sync.invalid";
process.env.GIT_CONFIG_GLOBAL = os.devNull;
process.env.GIT_CONFIG_SYSTEM = os.devNull;
delete process.env.PI_SUBAGENT_DEPTH;

async function git(dir: string, ...args: string[]) {
	return (await exec("git", args, { cwd: dir })).stdout;
}
async function write(dir: string, file: string, value: string) {
	await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
	await fs.writeFile(path.join(dir, file), value);
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-log-exclusion-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const dir = path.join(root, "agent"),
		remote = path.join(root, "remote.git");
	await fs.mkdir(dir);
	await git(root, "init", "--bare", "-b", "main", remote);
	await write(dir, "settings.json", '{"theme":"dark"}\n');
	await write(dir, configFile, '{"permissionReviewLog":true}\n');
	return { root, dir, remote };
}

test("denies runtime log paths without blocking JSONL configuration", () => {
	for (const file of [
		logFile,
		debugFile,
		"extensions/other/logs/session.jsonl",
		logFile.replaceAll("/", "\\"),
	])
		assert.equal(isDenied(file), true, file);
	for (const file of [
		configFile,
		"extensions/other/data.jsonl",
		"extensions/catalogs/index.ts",
	])
		assert.equal(isDenied(file), false, file);
});

test("init and two-machine sync retain local logs and transfer configuration", async (t) => {
	const { root, dir, remote } = await fixture(t);
	await write(dir, logFile, "local audit\n");
	await write(dir, debugFile, "local debug\n");
	await runInit(remote, undefined, { dir, gh });
	const tree = await git(remote, "ls-tree", "-r", "--name-only", "HEAD");
	assert.ok(tree.includes(configFile));
	assert.ok(!tree.includes(logFile));
	assert.ok(!tree.includes(debugFile));
	assert.equal(
		await fs.readFile(path.join(dir, logFile), "utf8"),
		"local audit\n",
	);
	const second = path.join(root, "second");
	await fs.mkdir(second);
	await write(second, logFile, "second audit\n");
	await runLink(remote, undefined, { dir: second, gh });
	await write(
		dir,
		configFile,
		'{"permissionReviewLog":true,"debugLog":false}\n',
	);
	await runSync(undefined, { auto: false, push: true }, { dir, gh });
	await runSync(undefined, { auto: false, push: true }, { dir: second, gh });
	assert.equal(
		await fs.readFile(path.join(second, configFile), "utf8"),
		await fs.readFile(path.join(dir, configFile), "utf8"),
	);
	assert.equal(
		await fs.readFile(path.join(second, logFile), "utf8"),
		"second audit\n",
	);
});

test("excluded log directories are not reported as sync gaps", async (t) => {
	const { dir, remote } = await fixture(t);
	await write(dir, logFile, "audit\n");
	await write(dir, "extensions/pi-permission-system/api-token.json", "{}\n");
	await runInit(remote, undefined, { dir, gh });
	const { denied } = await syncGaps(dir);
	assert.ok(
		!denied.some((file) => file.split("/").includes("logs")),
		denied.join(", "),
	);
	assert.ok(
		denied.includes("extensions/pi-permission-system/api-token.json"),
		denied.join(", "),
	);
});

test("managed ignore rules remain effective after regeneration and extraPaths", async (t) => {
	const { dir } = await fixture(t);
	await git(dir, "init", "-b", "main");
	await write(dir, logFile, "audit\n");
	await ensureIgnoreRules(dir, {
		extraPaths: ["extensions/pi-permission-system/logs"],
	});
	await ensureIgnoreRules(dir, {
		extraPaths: ["extensions/pi-permission-system"],
	});
	assert.equal((await git(dir, "check-ignore", logFile)).trim(), logFile);
});

test("force-staged logs are refused even when ignore rules are bypassed", async (t) => {
	const { dir, remote } = await fixture(t);
	await runInit(remote, undefined, { dir, gh });
	await write(dir, logFile, "audit\n");
	await git(dir, "add", "-f", "--", logFile);
	await assert.rejects(() => commitLocalChanges({ dir }), /REFUSED to commit/);
});

test("a deletion commit can untrack a previously committed log without deleting it locally", async (t) => {
	const { dir, remote } = await fixture(t);
	await runInit(remote, undefined, { dir, gh });
	await write(dir, logFile, "audit\n");
	await git(dir, "add", "-f", "--", logFile);
	await git(dir, "commit", "-m", "legacy log");
	await git(dir, "rm", "--cached", "--", logFile);
	assert.equal(await commitLocalChanges({ dir }), true);
	assert.equal((await git(dir, "ls-files", "--", logFile)).trim(), "");
	assert.equal(await fs.readFile(path.join(dir, logFile), "utf8"), "audit\n");
});

test("sync refuses a committed log even when the worktree is clean", async (t) => {
	const { dir, remote } = await fixture(t);
	await runInit(remote, undefined, { dir, gh });
	const before = await git(remote, "rev-parse", "HEAD");
	await write(dir, logFile, "audit\n");
	await git(dir, "add", "-f", "--", logFile);
	await git(dir, "commit", "-m", "legacy log");
	await assert.rejects(
		() =>
			runSync(
				undefined,
				{ auto: false, push: true, skipPull: true },
				{ dir, gh },
			),
		/REFUSED to push/,
	);
	assert.equal(await git(remote, "rev-parse", "HEAD"), before);
});

test("sync refuses unpushed log history even after a later deletion", async (t) => {
	const { dir, remote } = await fixture(t);
	await runInit(remote, undefined, { dir, gh });
	const before = await git(remote, "rev-parse", "HEAD");
	await write(dir, logFile, "audit\n");
	await git(dir, "add", "-f", "--", logFile);
	await git(dir, "commit", "-m", "legacy log");
	await git(dir, "rm", "--cached", "--", logFile);
	await git(dir, "commit", "-m", "remove log");
	await assert.rejects(
		() =>
			runSync(
				undefined,
				{ auto: false, push: true, skipPull: true },
				{ dir, gh },
			),
		/REFUSED to push/,
	);
	assert.equal(await git(remote, "rev-parse", "HEAD"), before);
});

test("initial push refuses log history even when its tip no longer tracks the log", async (t) => {
	const { dir, remote } = await fixture(t);
	await git(dir, "init", "-b", "main");
	await write(dir, logFile, "audit\n");
	await git(dir, "add", ".");
	await git(dir, "commit", "-m", "old log");
	await git(dir, "rm", "--", logFile);
	await git(dir, "commit", "-m", "remove old log");
	await assert.rejects(
		() => runInit(remote, undefined, { dir, gh }),
		/REFUSED to push/,
	);
	assert.equal((await git(remote, "for-each-ref", "refs/heads")).trim(), "");
});

test("a deletion can sync when the old log history is already on origin", async (t) => {
	const { dir, remote } = await fixture(t);
	await runInit(remote, undefined, { dir, gh });
	await write(dir, logFile, "audit\n");
	await git(dir, "add", "-f", "--", logFile);
	await git(dir, "commit", "-m", "previously uploaded log");
	await git(dir, "push");
	await git(dir, "rm", "--cached", "--", logFile);
	await runSync(undefined, { auto: false, push: true }, { dir, gh });
	assert.ok(
		!(await git(remote, "ls-tree", "-r", "--name-only", "HEAD")).includes(
			logFile,
		),
	);
	assert.equal(await fs.readFile(path.join(dir, logFile), "utf8"), "audit\n");
});
