import path from "node:path";
import { RUNTIME_LOG_DIR } from "./constants.ts";

export function isDenied(file: string) {
	const parts = file
		.toLowerCase()
		.replaceAll("\\", "/")
		.split("/")
		.filter(Boolean);
	return parts.some(
		(part) =>
			[
				"sessions",
				"state",
				"npm",
				"git",
				"bin",
				".git-sync",
				"node_modules",
				RUNTIME_LOG_DIR,
			].includes(part) ||
			part.startsWith("auth") ||
			part.includes("token") ||
			part.includes("secret") ||
			part.includes("credential") ||
			part === ".env" ||
			part.includes(".env.") ||
			part.endsWith(".env") ||
			part.endsWith(".local.json"),
	);
}

export function validExtra(entry: string) {
	return (
		entry.trim() !== "" &&
		!entry.includes("..") &&
		!path.isAbsolute(entry) &&
		!isDenied(entry)
	);
}
