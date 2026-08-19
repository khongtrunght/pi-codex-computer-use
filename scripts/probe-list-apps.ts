#!/usr/bin/env tsx

import { AppServerClient } from "../src/app-server-client.ts";
import { ComputerUseBackend } from "../src/computer-use-backend.ts";
import { getComputerUseAppServerArgs } from "../src/codex-installation.ts";
import { CodexThreadManager } from "../src/thread-manager.ts";

const client = new AppServerClient({
	requestTimeoutMs: 120_000,
	codexArgs: getComputerUseAppServerArgs(),
});
client.onServerRequest((request, responder) => {
	responder.reject({ code: -32601, message: `Unexpected server request during list-apps probe: ${request.method}` });
});

try {
	await client.request("initialize", {
		clientInfo: { name: "pi-codex-computer-use-probe", version: "0.1.0" },
		capabilities: { experimentalApi: true },
	});
	const backend = new ComputerUseBackend(client, new CodexThreadManager(client));
	const result = await backend.callTool(process.cwd(), "list_apps", {});
	for (const block of result.content) {
		if (block.type === "text") console.log(block.text);
	}
} finally {
	await client.stop();
}
