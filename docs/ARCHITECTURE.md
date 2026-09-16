# Architecture

This extension bridges Pi tools to OpenAI Codex Computer Use without implementing any desktop automation itself. Codex app-server owns the plugin lifecycle, MCP server startup, and the native permission model; the extension is a thin, safety-conscious client.

```text
Pi extension (src/index.ts)
  -> Codex app-server (codex app-server --listen stdio://)
    -> Codex computer-use MCP server
      -> Codex Computer Use macOS app/service (SkyComputerUseClient)
        -> local desktop
```

## Why app-server instead of direct MCP

Pi has no built-in MCP support, so the extension must be the client either way. Two options were explored:

1. **Codex app-server (chosen):** the extension speaks app-server's JSONL protocol and calls `mcpServer/tool/call`. App-server owns plugin install/enable state, marketplace registration, MCP server startup/reload, and the permission/elicitation flow. This matches Codex's intended safety model.
2. **Direct `SkyComputerUseClient mcp` (rejected for now):** simpler raw tool calls, but requires a full MCP client and bypasses Codex's plugin lifecycle and permission handling.

## Module map

| Module | Responsibility |
| --- | --- |
| `src/index.ts` | Extension entry: registers tools, `/computer-use` commands, session lifecycle hooks |
| `src/runtime.ts` | Lazy runtime state machine: spawn/connect, idle shutdown, elicitation bridging, footer status |
| `src/app-server-client.ts` | JSONL request/response client over the spawned `codex app-server` process |
| `src/protocol.ts` | Narrow TypeScript types for the app-server methods we use |
| `src/thread-manager.ts` | One ephemeral Codex thread per runtime; reset on restart/`/new`/`/fork`/`/reload` |
| `src/computer-use-backend.ts` | Thin adapter: ensure thread, call `mcpServer/tool/call`, normalize errors, retry stale threads |
| `src/computer-use-tools.ts` | Pi tool registration with TypeBox schemas, queue, content conversion |
| `src/queue.ts` | Promise-chain queue serializing all Computer Use calls |
| `src/content.ts` | MCP content -> Pi content blocks (text truncation, image preservation) |
| `src/status.ts` | Readiness checks and `/computer-use status` formatting |
| `src/footer-status.ts` | Pi footer status line (`Computer Use: idle/ready/<app>/…`) |
| `src/log.ts` | Opt-in debug logging with sensitive-field redaction |

## App-server protocol

Messages are newline-delimited JSON objects (`{id, method, params}`) — no `Content-Length` framing. The verified flow:

1. Spawn: `<codex> app-server --listen stdio://`

   `resolveCodexCommand()` prefers the host app's bundled CLI
   (`/Applications/ChatGPT.app/Contents/Resources/codex`) over the `codex` on `PATH`,
   and falls back to `PATH` only when the app is absent (`PI_CUA_CODEX_COMMAND`
   overrides both). App-server and `SkyComputerUseClient` ship inside the same host
   app and are built against the same MCP capabilities, so they must stay in
   lockstep. A newer `codex` on `PATH` advertises capabilities the bundled client
   cannot decode; thread-scoped MCP startup then fails with
   `-32603 Internal error: The data couldn't be read because it isn't in the correct
   format`, even though `mcpServerStatus/list` still reports the server and its tools
   as healthy. See [Verifying readiness](#verifying-readiness).
2. Initialize:

   ```json
   {"id":1,"method":"initialize","params":{"clientInfo":{"name":"...","version":"..."},"capabilities":{"experimentalApi":true}}}
   ```

3. Check plugin state: `plugin/list` — expects `computer-use@openai-bundled` with `installed: true`, `enabled: true`.
4. Start an ephemeral thread (required — `mcpServer/tool/call` rejects arbitrary thread IDs):

   ```json
   {"id":3,"method":"thread/start","params":{"cwd":"...","ephemeral":true}}
   ```

5. Call tools:

   ```json
   {"id":4,"method":"mcpServer/tool/call","params":{"server":"computer-use","tool":"list_apps","threadId":"<id>","arguments":{}}}
   ```

Other methods used: `marketplace/add`, `plugin/install`, `config/mcpServer/reload`, `mcpServerStatus/list`. Method names are centralized in `src/protocol.ts` to limit version-drift surface.

The bundled plugin currently lives under `/Applications/ChatGPT.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use` (legacy releases used Codex.app). Installed plugins are cached under `$CODEX_HOME/plugins/cache`. Its `.mcp.json` launches `SkyComputerUseClient mcp`.

Some ChatGPT.app releases also write a disabled `mcp_servers.computer-use` entry with a relative command into `config.toml`. That user-level entry shadows the enabled plugin when Pi launches app-server from another working directory. The extension discovers the installed plugin cache and passes process-local Codex config overrides for the launcher path, working directory, and enabled state. It never rewrites the user's config.

## Thread management

`mcpServer/tool/call` requires a thread ID known to app-server. The extension keeps one ephemeral thread per runtime, reuses it for all calls, and recreates it when app-server restarts or the Pi session changes (`/new`, `/fork`, `/reload`). If a call fails with `thread not found` / invalid thread ID (app-server forgot the ephemeral thread), the backend resets the thread and retries once.

## Permission / elicitation bridge

App-server sends server-requests like:

```json
{"method":"mcpServer/elicitation/request","id":0,"params":{"serverName":"computer-use","message":"Allow ChatGPT to use Finder?"}}
```

The prompt names the host app, not the product: ChatGPT.app-hosted builds say
`Allow ChatGPT to use Finder?`, legacy Codex.app builds say
`Allow Codex to use Finder?`. Parse with `ELICITATION_APP_PATTERN`, which accepts both.

Flow:

1. `AppServerClient` surfaces the request to the runtime.
2. With UI available, the runtime asks via `ctx.ui.confirm()` and replies `accept` / `decline` / `cancel`.
3. With no UI (print mode), the request is declined — fail closed.
4. Dev-only exception: apps on the `PI_CUA_DEV_AUTO_ACCEPT_APPS` allowlist are auto-accepted. Accepted grants may persist in Codex's own permission store.

## Content conversion

`get_app_state` returns text (accessibility tree) plus a base64 JPEG screenshot. Conversion rules (`src/content.ts`):

- Text blocks pass through with Pi truncation conventions for huge trees.
- Image blocks are preserved untruncated; missing MIME types default to `image/jpeg` (observed Codex output omits it).
- Screenshots/base64 are never logged.

## Concurrency

Pi may execute tool calls in parallel; desktop automation must not. All Computer Use calls flow through a single promise-chain queue in the tools layer, so click/type/scroll sequences never interleave.

## Runtime lifecycle

The runtime is lazy: nothing spawns until a `/computer-use` command or `computer_use_*` tool needs the backend. Cleanup is triggered by the agent finishing its turn, `/computer-use disable`/`restart`, Pi session shutdown, or the idle timeout (`PI_CUA_IDLE_TIMEOUT_MS`, default 10 minutes). Shutting down the app-server client also tears down the spawned `SkyComputerUseClient` process.

## Version drift

Codex Computer Use and app-server APIs may change between releases. Tool schemas are static definitions for the known tool surface; `/computer-use status` reports the Codex CLI version, plugin state, MCP server status, and live tool list so drift is visible. If the live tool list diverges from the static schemas, that's the signal to update `src/computer-use-tools.ts`.

The host app and the Codex CLI drift independently, and that is the sharp edge:
`SkyComputerUseClient` is installed by ChatGPT.app, while `codex` may come from a
separate install (npm global, Homebrew, etc.). `resolveCodexCommand()` pins
app-server to the host app's bundled CLI for this reason, but a host app upgrade can
still ship a client that is *older* than a separately installed CLI.

Observed failure (ChatGPT.app 26.903.61454 with codex 0.153.4 bundled vs
npm `@openai/codex` 0.154.0). On `initialize`, 0.154.0 advertises an extra
capability:

```json
{"capabilities":{"experimental":{"codex/auth-change":{}},"elicitation":{"form":{},"url":{}}}}
```

0.153.4 sends only `{"elicitation":{"form":{},"url":{}}}`. The bundled Swift client
cannot decode `experimental`, so it answers `initialize` with
`-32603 Internal error: The data couldn't be read because it isn't in the correct
format`. Every `thread/start`-scoped MCP startup then fails with
`failed to get client: MCP startup failed: handshaking with MCP server failed`.

### Verifying readiness

`mcpServerStatus/list` is **not** a readiness check. It starts the MCP server long
enough to list tools, so it reports `serverInfo` and all ten tools even when the
handshake that `thread/start` performs is broken. A status check built only on
`mcpServerStatus/list` reports `ready` while every tool call fails.

To prove Computer Use actually works, take the thread-scoped path end to end:
`initialize` -> `thread/start` (`ephemeral: true`) -> `mcpServer/tool/call` with a
read-only tool such as `list_apps`. `npm run probe:list-apps` does exactly that and
is the authoritative readiness probe.

Known gap: `checkComputerUseStatus()` currently uses `mcpServerStatus/list` alone,
plus the plugin listing. It can therefore report `ready` in this failure mode. A
correct probe needs a thread-scoped `list_apps` call (read-only, no elicitation).
