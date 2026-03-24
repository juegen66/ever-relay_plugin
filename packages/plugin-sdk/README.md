# EverRelay Plugin SDK

TypeScript SDK for EverRelay iframe plugins.

EverRelay opens your plugin inside an `iframe` and appends `everrelayWindowId` to the plugin URL. Your plugin uses this SDK to:

- register tools with the EverRelay host
- receive tool calls over `postMessage`
- return tool results
- emit readiness and custom events

> **Repo note:** This file documents **`@everrelay/plugin-sdk`**. The `tools/test-mcp-afs` package is a separate MCP server test harness, not the iframe plugin SDK.

## Install

```bash
pnpm add @everrelay/plugin-sdk
```

## Runtime contract

- Query param injected by host: `everrelayWindowId`
- RPC channel: `everrelay:plugin:rpc`
- Envelope shape: `{ channel, v: 1, type, appInstanceId, payload }`
- Host to iframe: `call`
- Iframe to host: `register`, `result`, `ready`, `event`

Tool names exposed to the host are typically namespaced as `tp_<slug>__<toolName>`. In your iframe code you still register the **logical** tool `name` (e.g. `get_weather`); EverRelay maps that to the namespaced name when exposing tools to the agent.

## How to use it (end-to-end)

1. **Host loads your plugin** — EverRelay sets the iframe `src` to your app URL and adds `?everrelayWindowId=<instanceId>` (and any other query params you configured).
2. **Your app boots** — In the iframe, read that id with `HostBridge.resolveAppInstanceIdFromLocation()`. If it is missing, you are not inside EverRelay (e.g. opened in a new tab); handle that case in your UI.
3. **Create the bridge** — `new HostBridge({ appInstanceId })` attaches a `window` `message` listener and targets the parent frame. Optionally pass `targetOrigin` if the parent origin is fixed; otherwise the SDK prefers `document.referrer`’s origin, then falls back to `"*"`.
4. **Register tools** — For each tool, call `registerTool({ id, name, description, parameters, handler })`. The `parameters` object should be a JSON Schema–style description (what the host shows to the model).
5. **Publish descriptors** — Call `registerTools()` once so the parent receives the full tool list (`register` message).
6. **Signal readiness** — Call `signalReady({ version: "1.0.0" })` so the host knows your iframe finished setup.
7. **Runtime** — When the host invokes a tool, it sends a `call` message; your `handler` runs and the SDK automatically posts a `result` (success or thrown error). You can also call `emitEvent("something_happened", { ... })` for host-side listeners.

Call order should be: **construct → `registerTool` (repeat) → `registerTools()` → `signalReady()`**. Destroy the bridge on teardown (e.g. React `useEffect` cleanup) with `bridge.destroy()`.

## Quick start

```ts
import { HostBridge } from "@everrelay/plugin-sdk"

const appInstanceId = HostBridge.resolveAppInstanceIdFromLocation()

if (!appInstanceId) {
  throw new Error("Missing everrelayWindowId in the iframe URL")
}

const bridge = new HostBridge({ appInstanceId })

bridge.registerTool({
  id: "hello",
  name: "hello",
  description: "Say hello to the active user",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Optional user name" },
    },
  },
  handler: async (args) => {
    const name = typeof args.name === "string" ? args.name : "there"
    return { message: `Hi ${name}` }
  },
})

bridge.registerTools()
bridge.signalReady({ version: "1.0.0" })

// Optional: notify the host about UI-level events
bridge.emitEvent("plugin_ui_loaded", { screen: "home" })
```

### `onTool` + `registerTools(descriptors)` (advanced)

If you split metadata and handlers, use `onTool(name, handler)` and pass an explicit descriptor list into `registerTools([...])`. The usual path is **`registerTool`**, which registers both at once.

### Full example in this repo

The weather demo registers three tools, updates React state from handlers, and cleans up `HostBridge` on unmount:

[`examples/demo-weather-react/src/app.tsx`](../../examples/demo-weather-react/src/app.tsx)

Run it locally after building the SDK:

```bash
pnpm demo-weather:dev
```

Then open the dev server URL **from EverRelay** so the iframe gets a real `everrelayWindowId`. For a quick sanity check in the browser alone, you can append `?everrelayWindowId=dev-local` — the bridge will start, but without a real parent host, tool calls will not arrive.

## API

### `HostBridge.resolveAppInstanceIdFromLocation()`

Reads `everrelayWindowId` from `window.location.search`.

### `new HostBridge({ appInstanceId, targetOrigin? })`

Creates the iframe-side RPC bridge.

- `appInstanceId`: required iframe instance id from EverRelay
- `targetOrigin`: optional host origin for `postMessage`

If `targetOrigin` is omitted, the SDK tries to infer it from `document.referrer`.

### `bridge.onTool(name, handler)`

Registers a handler for a tool call.

### `bridge.registerTool(tool)`

Registers both the tool metadata and the tool handler in one call.

### `bridge.registerTools()`

Sends all registered tool descriptors to the host.

### `bridge.signalReady(payload?)`

Notifies the host that the plugin is ready.

### `bridge.emitEvent(name, data?)`

Emits a custom event to the host.

### `bridge.destroy()`

Removes the `message` listener and clears registered handlers.

## Local development

Build the SDK from the repo root:

```bash
pnpm build:sdk
```

Create a publishable tarball:

```bash
pnpm pack:sdk
```

The tarball is written under `packages/plugin-sdk` (npm pack output).

Run the React demo app:

```bash
pnpm demo-weather:dev
```

## Demo

- React + Vite demo: [`examples/demo-weather-react`](../../examples/demo-weather-react) (`pnpm demo-weather:dev`)
