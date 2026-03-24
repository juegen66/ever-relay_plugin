# EverRelay Third-Party SDK

## Introduction

This repo is the **developer workspace** for EverRelay **third-party apps**—integrations that show up inside the EverRelay client alongside optional backend services.

- **Iframe plugins** — Your UI runs in an iframe; the host adds `everrelayWindowId` to the URL. Use the published package **`@everrelay/plugin-sdk`** (`HostBridge`) to register tools, handle RPC over `postMessage`, and signal readiness. Full contract, API, and walkthrough: [packages/plugin-sdk/README.md](packages/plugin-sdk/README.md).
- **MCP servers (optional)** — The desktop agent can bind to an MCP URL (HTTP or stdio). **`tools/test-mcp-afs`** is a self-contained example that exposes AFS Memory/Skill tools for local testing; see [tools/test-mcp-afs/README.md](tools/test-mcp-afs/README.md).
- **Shipping demos into the main app** — Build the weather demo, then run **`export:host-assets`** so static files land in the main EverRelay app’s public third-party folder (see below).

Typical flow: develop against this repo → run demos locally → export built assets when you want them committed in the main product repo.

## Contents

| Path | Purpose |
|------|--------|
| [packages/plugin-sdk](packages/plugin-sdk) | Publishable iframe SDK (`@everrelay/plugin-sdk`) |
| [examples/demo-weather-react](examples/demo-weather-react) | React + Vite demo using the SDK (`pnpm demo-weather:dev`) |
| [tools/test-mcp-afs](tools/test-mcp-afs) | Local MCP server for Memory/Skill + desktop agent binding tests |
| `host-pages/test-mcp-afs` | Static host-window HTML copied by `export:host-assets` into the main app |
| [scripts/export-host-assets.mjs](scripts/export-host-assets.mjs) | Copies `demo-weather` build + test MCP host page to a target `third-party-apps` dir |

## Requirements

- Node 22+
- `pnpm`

## Install

```bash
pnpm install
```

## Common Commands

```bash
pnpm build
pnpm build:sdk
pnpm pack:sdk
pnpm demo-weather:dev
pnpm build:demo-weather
pnpm test-mcp-afs:http
```

## Sync Host Assets Into The Main App

Build the weather demo, then export the host-facing files into the main app repo:

```bash
pnpm build:demo-weather
pnpm export:host-assets -- --target ../v0-apple-browser-app/fronted/public/third-party-apps
```

This writes:

- `demo-weather/*`
- `test-mcp-afs/index.html`

The main app keeps those exported files committed so built-in third-party demos keep working without this repo at runtime.
