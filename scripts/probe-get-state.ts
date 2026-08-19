#!/usr/bin/env tsx

import { AppServerClient } from "../src/app-server-client.ts";
import { ComputerUseBackend } from "../src/computer-use-backend.ts";
import { getComputerUseAppServerArgs } from "../src/codex-installation.ts";
import { CodexThreadManager } from "../src/thread-manager.ts";

const app = process.argv[2] ?? "Finder";
const client = new AppServerClient({
	requestTimeoutMs: 120_000,
	codexArgs: getComputerUseAppServerArgs(),
});
client.onServerRequest((request, responder) => {
	if (request.method === "mcpServer/elicitation/request") {
		console.error(`Auto-accepting probe elicitation: ${JSON.stringify(request.params)}`);
		responder.accept({ action: "accept", content: {} });
		return;
	}
	responder.reject({ code: -32601, message: `Unexpected server request during get-state probe: ${request.method}` });
});

try {
	await client.request("initialize", {
		clientInfo: { name: "pi-codex-computer-use-probe", version: "0.1.0" },
		capabilities: { experimentalApi: true },
	});
	const backend = new ComputerUseBackend(client, new CodexThreadManager(client));
	const result = await backend.callTool(process.cwd(), "get_app_state", { app });
	for (const block of result.content) {
		if (block.type === "text") console.log(block.text.slice(0, 8000));
		if (block.type === "image") console.log(`[image ${block.mimeType}, ${block.data.length} base64 chars]`);
	}
} finally {
	await client.stop();
}
