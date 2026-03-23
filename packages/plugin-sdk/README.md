# EverRelay Plugin SDK

TypeScript SDK for EverRelay iframe plugins.

EverRelay opens your plugin inside an `iframe` and appends `everrelayWindowId` to the plugin URL. Your plugin uses this SDK to:

- register tools with the EverRelay host
- receive tool calls over `postMessage`
- return tool results
- emit readiness and custom events

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

Tool names exposed to the host are typically namespaced as `tp_<slug>__<toolName>`.

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
```

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

The tarball is written into [`packages/plugin-sdk`](/Users/qiaodailong/Desktop/article/everrelay-third-party-sdk/packages/plugin-sdk).

Run the React demo app:

```bash
pnpm demo-weather:dev
```

## Demo

- React demo source: [`examples/demo-weather-react`](/Users/qiaodailong/Desktop/article/everrelay-third-party-sdk/examples/demo-weather-react)
- SDK demo redirect: [`packages/plugin-sdk/examples/demo-weather/index.html`](/Users/qiaodailong/Desktop/article/everrelay-third-party-sdk/packages/plugin-sdk/examples/demo-weather/index.html)
