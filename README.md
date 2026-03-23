# EverRelay Third-Party SDK

Developer workspace for EverRelay third-party apps.

## Contents

- `packages/plugin-sdk`: published iframe SDK package (`@everrelay/plugin-sdk`)
- `examples/demo-weather-react`: React demo app that uses the SDK
- `tools/test-mcp-afs`: local MCP harness for desktop third-party agent testing
- `host-pages/test-mcp-afs`: static host window page exported into the main app
- `scripts/export-host-assets.mjs`: copies host-facing assets back into the main app repo

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
