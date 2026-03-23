import "./env"

import http from "node:http"

import { createAfsMcpServer } from "./server"

const host = process.env.AFS_MCP_HTTP_HOST?.trim() || "127.0.0.1"
const port = Number.parseInt(process.env.AFS_MCP_HTTP_PORT?.trim() || "3310", 10)
const httpPath = process.env.AFS_MCP_HTTP_PATH?.trim() || "/mcp"

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid AFS_MCP_HTTP_PORT: ${process.env.AFS_MCP_HTTP_PORT ?? ""}`)
}

const server = createAfsMcpServer()

const httpServer = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || httpPath, `http://${req.headers.host || `${host}:${port}`}`)

  if (requestUrl.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: true, name: "test-mcp-afs", transport: "http" }))
    return
  }

  if (requestUrl.pathname !== httpPath) {
    res.writeHead(404, { "content-type": "application/json" })
    res.end(
      JSON.stringify({
        error: "Not found",
        expectedPath: httpPath,
      })
    )
    return
  }

  try {
    await server.startHTTP({
      url: requestUrl,
      httpPath,
      req,
      res,
    })
  } catch (error) {
    console.error("[test-mcp-afs] HTTP transport error", error)
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" })
    }
    if (!res.writableEnded) {
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Unknown MCP HTTP error",
        })
      )
    }
  }
})

httpServer.listen(port, host, () => {
  console.warn(`[test-mcp-afs] HTTP MCP server listening on http://${host}:${port}${httpPath}`)
})

const shutdown = async (signal: string) => {
  console.warn(`[test-mcp-afs] Received ${signal}, shutting down HTTP MCP server`)
  httpServer.close((error) => {
    if (error) {
      console.error("[test-mcp-afs] Failed to close HTTP listener", error)
    }
  })

  try {
    await server.close()
  } catch (error) {
    console.error("[test-mcp-afs] Failed to close MCP server", error)
  }

  process.exit(0)
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}
