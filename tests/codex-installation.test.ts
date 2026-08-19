import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	findBundledMarketplaceRoot,
	findComputerUseAppPath,
	getComputerUseAppServerArgs,
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
