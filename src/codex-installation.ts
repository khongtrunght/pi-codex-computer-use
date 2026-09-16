import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_CHATGPT_APP_PATH = "/Applications/ChatGPT.app";
export const DEFAULT_CODEX_APP_PATH = "/Applications/Codex.app";

export function getCodexHome(): string {
	return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

export function resolveInstalledComputerUsePluginRoot(codexHome = getCodexHome()): string | undefined {
	const versionsRoot = join(codexHome, "plugins", "cache", "openai-bundled", "computer-use");
	let versions: string[];
	try {
		versions = readdirSync(versionsRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
	} catch {
		return undefined;
	}

	return versions
		.map((version) => join(versionsRoot, version))
		.find((root) => existsSync(join(root, "bin", "computer-use-client-launcher")));
}

export const BUNDLED_CODEX_RELATIVE_PATH = join("Contents", "Resources", "codex");

/**
 * Resolve the Codex CLI used to spawn app-server.
 *
 * The Computer Use MCP server (`SkyComputerUseClient`) ships inside the same host
 * app as its bundled Codex CLI, so the two are built against the same MCP
 * capabilities. A newer `codex` from `PATH` can advertise capabilities the
 * bundled client cannot decode, which fails every thread-scoped MCP startup with
 * `-32603 Internal error: The data couldn't be read...`.
 *
 * Prefer the host app's bundled CLI so app-server and the Computer Use client stay
 * in lockstep; fall back to `PATH` when the app is not installed.
 */
export function resolveCodexCommand(
	chatGptAppPath = DEFAULT_CHATGPT_APP_PATH,
	legacyCodexAppPath = DEFAULT_CODEX_APP_PATH,
): string {
	const override = process.env.PI_CUA_CODEX_COMMAND;
	if (override) return override;

	const appPath = findComputerUseAppPath(chatGptAppPath, legacyCodexAppPath);
	if (appPath) {
		const bundled = join(appPath, BUNDLED_CODEX_RELATIVE_PATH);
		if (existsSync(bundled)) return bundled;
	}

	return "codex";
}

export function getComputerUseAppServerArgs(codexHome = getCodexHome()): string[] {
	const pluginRoot = resolveInstalledComputerUsePluginRoot(codexHome);
	if (!pluginRoot) return [];

	const launcher = join(pluginRoot, "bin", "computer-use-client-launcher");
	return [
		"-c",
		`mcp_servers.computer-use.command=${JSON.stringify(launcher)}`,
		"-c",
		`mcp_servers.computer-use.cwd=${JSON.stringify(pluginRoot)}`,
		"-c",
		"mcp_servers.computer-use.enabled=true",
	];
}

export function findComputerUseAppPath(
	chatGptAppPath = DEFAULT_CHATGPT_APP_PATH,
	legacyCodexAppPath = DEFAULT_CODEX_APP_PATH,
): string | undefined {
	if (existsSync(chatGptAppPath)) return chatGptAppPath;
	if (existsSync(legacyCodexAppPath)) return legacyCodexAppPath;
	return undefined;
}

export function findBundledMarketplaceRoot(...candidates: string[]): string | undefined {
	const roots = candidates.length > 0
		? candidates
		: [DEFAULT_CHATGPT_APP_PATH, DEFAULT_CODEX_APP_PATH]
			.map((appPath) => join(appPath, "Contents", "Resources", "plugins", "openai-bundled"));
	return roots.find((root) => existsSync(root));
}
