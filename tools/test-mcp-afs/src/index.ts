import "./env"

import { createAfsMcpServer } from "./server"

const server = createAfsMcpServer()

// Avoid top-level await: tsx may compile MCP entry as CJS (TLA unsupported).
void server.startStdio().catch((err) => {
  console.error(err)
  process.exit(1)
})
