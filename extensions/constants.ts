export const STATUS_KEY = "git-sync";
export const START = "# >>> pi-config-sync managed — do not edit inside this block";
export const END = "# <<< pi-config-sync managed";
export const LEGACY_MARKERS: Array<[string, string]> = [
	[
		"# >>> pi-git-sync managed — do not edit inside this block",
		"# <<< pi-git-sync managed",
	],
];
export const DEFAULT_PATHS = [
	".gitignore",
	".gitattributes",
	"settings.json",
	"AGENTS.md",
	"git-sync.jsonc",
	"extensions",
	"chains",
	"prompts",
	"themes",
	"skills",
];
export const DEFAULT_MACHINE_LOCAL = ["lastChangelogVersion"];
export const RUNTIME_LOG_DIR = "logs";
export const IGNORE_DENY = [
	`**/${RUNTIME_LOG_DIR}/`,
	"auth*",
	"*token*",
	"*secret*",
	"*credential*",
	"*.env",
	"*.env.*",
	"*.local.json",
	"**/node_modules/",
	".DS_Store",
];
export const LIKELY_SYNC_REPO_NAMES = [
	"pi-agent-config",
	"my-pi-config",
	"pi-config",
	"dotfiles-pi",
];
