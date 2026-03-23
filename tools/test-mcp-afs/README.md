# Test MCP AFS (standalone)

Self-contained MCP server exposing AFS **Memory** and **Skill** via Mastra `MCPServer`. Uses **this folder’s own** `pnpm` install and **copied** AFS code under `src/afs`, `src/core`, `src/db` — not the main app repo’s `server/` modules.

## Prerequisites

- Node **≥ 22.13** (required by `@mastra/mcp`)
- PostgreSQL with the same schema as the main app (`afs_memory`, `afs_skill`, etc.)
- `test-mcp-afs/.env` with at least `DATABASE_URL` (see below)

## Setup

Run from the repo root with `pnpm install`, or from this directory with `pnpm install`.

Link or copy env from the main app repo (one-time):

```bash
ln -sf ../../v0-apple-browser-app/.env .env
# or: cp /absolute/path/to/v0-apple-browser-app/.env .env
```

## Run

From **this** directory:

```bash
pnpm mcp
# or watch mode:
pnpm dev
```

For the third-party agent integration in the main app, run the local HTTP transport instead:

```bash
pnpm mcp:http
# or watch mode:
pnpm dev:http
```

Defaults:

- host: `127.0.0.1`
- port: `3310`
- MCP path: `/mcp`

Override with env vars if needed:

```bash
AFS_MCP_HTTP_HOST=127.0.0.1 AFS_MCP_HTTP_PORT=3310 AFS_MCP_HTTP_PATH=/mcp pnpm mcp:http
```

From this repo root, you can also start the HTTP transport with:

```bash
pnpm test-mcp-afs:http
```

## Use with the desktop third-party agent

1. Start the main app in dev mode.
2. Start this local HTTP MCP server with `pnpm mcp-afs:http` from the repo root.
3. Save a binding for app slug `test_mcp_afs` to `http://127.0.0.1:3310/mcp`.
4. Open the built-in `Test MCP AFS` third-party app in the desktop.
5. Focus that window and open Copilot. The backend MCP tools will load automatically.

Example binding request:

```bash
curl -X PUT http://localhost:3000/api/third-party-mcp/bindings/test_mcp_afs \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <your-token>' \
  -d '{
    "serverUrl": "http://127.0.0.1:3310/mcp",
    "authType": "none"
  }'
```

In dev mode, the main app now allows loopback MCP URLs like `127.0.0.1` and `localhost` for this local test flow. Private LAN hosts such as `192.168.x.x` remain blocked.

### Cursor MCP config

Point `command` at the main app repo shell wrapper (`../v0-apple-browser-app/scripts/mcp-afs-demo.sh`) **or** at this package’s Node + entry:

```json
{
  "mcpServers": {
    "afs-demo": {
      "command": "/absolute/path/to/v0-apple-browser-app/test-mcp-afs/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/v0-apple-browser-app/test-mcp-afs/src/index.ts"],
      "cwd": "/absolute/path/to/v0-apple-browser-app/test-mcp-afs",
      "env": {
        "AFS_MCP_USER_ID": "your-user-id-here"
      }
    }
  }
}
```

If `AFS_MCP_USER_ID` is set, tools use it when `userId` is omitted.

### Semantic search

Configure embedding env vars in `.env` (same names as main app): `AFS_EMBEDDING_API_KEY`, `AFS_EMBEDDING_BASE_URL`, `AFS_EMBEDDING_MODEL`, `AFS_EMBEDDING_MODEL_VERSION`, `AFS_EMBEDDING_DIMENSIONS`.

## Tools

- **Memory**: `afs_mcp_memory_list`, `afs_mcp_memory_read`, `afs_mcp_memory_write`, `afs_mcp_memory_search`, `afs_mcp_memory_delete`
- **Skill**: `afs_mcp_skill_list`, `afs_mcp_skill_read`, `afs_mcp_skill_upsert`

## Syncing AFS code from the main repo

When `server/afs/*` or AFS-related schema changes, copy the relevant files into `src/afs/` and `src/db/schema.ts` (AFS subset) and adjust imports to use `@/core/*`, `@/db/*`, `@/afs/*`.
