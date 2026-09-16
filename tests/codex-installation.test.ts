import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	BUNDLED_CODEX_RELATIVE_PATH,
	findBundledMarketplaceRoot,
	findComputerUseAppPath,
	getComputerUseAppServerArgs,
	resolveCodexCommand,
	resolveInstalledComputerUsePluginRoot,
} from "../src/codex-installation.ts";

function tempHome(): string {
	return mkdtempSync(join(tmpdir(), "pi-cua-"));
}

function makePlugin(codexHome: string, version: string): string {
	const root = join(codexHome, "plugins", "cache", "openai-bundled", "computer-use", version);
	mkdirSync(join(root, "bin"), { recursive: true });
	writeFileSync(join(root, "bin", "computer-use-client-launcher"), "#!/bin/sh\n");
	return root;
}

describe("Codex Computer Use installation discovery", () => {
	it("uses the newest installed plugin cache version", () => {
		const codexHome = tempHome();
		makePlugin(codexHome, "1.0.9");
		const newest = makePlugin(codexHome, "1.0.10");

		expect(resolveInstalledComputerUsePluginRoot(codexHome)).toBe(newest);
	});

	it("adds app-server overrides that enable the installed launcher", () => {
		const codexHome = tempHome();
		const root = makePlugin(codexHome, "1.0.10");

		expect(getComputerUseAppServerArgs(codexHome)).toEqual([
			"-c",
			`mcp_servers.computer-use.command=${JSON.stringify(join(root, "bin", "computer-use-client-launcher"))}`,
			"-c",
			`mcp_servers.computer-use.cwd=${JSON.stringify(root)}`,
			"-c",
			"mcp_servers.computer-use.enabled=true",
		]);
	});

	it("returns no overrides when no installed launcher exists", () => {
		const codexHome = tempHome();
		expect(getComputerUseAppServerArgs(codexHome)).toEqual([]);
	});

	it("prefers ChatGPT.app as the current Codex host", () => {
		const codexHome = tempHome();
		const chatGptApp = join(codexHome, "ChatGPT.app");
		const legacyApp = join(codexHome, "Codex.app");
		mkdirSync(chatGptApp, { recursive: true });
		mkdirSync(legacyApp, { recursive: true });

		expect(findComputerUseAppPath(chatGptApp, legacyApp)).toBe(chatGptApp);
	});

	it("finds the bundled marketplace in ChatGPT.app", () => {
		const root = join(tempHome(), "ChatGPT.app", "Contents", "Resources", "plugins", "openai-bundled");
		mkdirSync(root, { recursive: true });
		expect(findBundledMarketplaceRoot(root)).toBe(root);
	});
});

describe("Codex CLI resolution", () => {
	function makeApp(root: string, name: string): { app: string; codex: string } {
		const app = join(root, name);
		const codex = join(app, BUNDLED_CODEX_RELATIVE_PATH);
		mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
		writeFileSync(codex, "#!/bin/sh\n");
		return { app, codex };
	}

	it("prefers the host app's bundled CLI over PATH", () => {
		const root = tempHome();
		const { app, codex } = makeApp(root, "ChatGPT.app");

		expect(resolveCodexCommand(app, join(root, "missing.app"))).toBe(codex);
	});

	it("honors an explicit override", () => {
		const root = tempHome();
		const { app } = makeApp(root, "ChatGPT.app");
		process.env.PI_CUA_CODEX_COMMAND = "/opt/codex/bin/codex";
		try {
			expect(resolveCodexCommand(app, join(root, "missing.app"))).toBe("/opt/codex/bin/codex");
		} finally {
			delete process.env.PI_CUA_CODEX_COMMAND;
		}
	});

	it("falls back to PATH when no host app is installed", () => {
		const root = tempHome();
		expect(resolveCodexCommand(join(root, "ChatGPT.app"), join(root, "Codex.app"))).toBe("codex");
	});
});
