import type {
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export interface GitSyncConfig {
	autoSyncIntervalMinutes?: number;
	autoSyncOnSessionStart?: boolean;
	extraPaths?: string[];
	includeHostname?: boolean;
	machineLocalSettings?: string[];
	nodePath?: string;
	warnOnPublicRemote?: boolean;
}
export interface GhClient {
	available(): Promise<boolean>;
	currentUser(): Promise<string>;
	repoExists(id: string): Promise<boolean>;
	isPrivate(id: string): Promise<boolean | undefined>;
	createPrivateRepo(id: string): Promise<void>;
	remoteUrl(id: string): string;
}
export interface Deps {
	dir?: string;
	gh?: GhClient;
	notify?: (message: string, level: Level) => void;
	runtime?: Runtime;
}
export interface Runtime {
	bundled: boolean;
	execPath: string;
	pathEnv?: string;
	platform?: NodeJS.Platform;
}
export type Level = "info" | "warning" | "error";
export type Ctx = ExtensionContext | ExtensionCommandContext;
