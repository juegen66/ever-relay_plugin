import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import { afs } from "@/afs"

const NAMESPACE_TREE = afs.getNamespaceTree()

function assertMemoryPath(path: string): void {
  if (!path.includes("/Memory/")) {
    throw new Error(`Path must be under Memory kind (e.g. Desktop/Memory/user/...): ${path}`)
  }
}

function getUserId(input: { userId?: string }): string {
  const uid = input.userId ?? process.env.AFS_MCP_USER_ID
  if (!uid) throw new Error("userId required (or set AFS_MCP_USER_ID)")
  return uid
}

const userIdSchema = z.string().describe("User ID (or set AFS_MCP_USER_ID env for default)")

export const memoryTools = {
  afs_mcp_memory_list: createTool({
    id: "afs_mcp_memory_list",
    description:
      "List nodes in AFS Memory. Path must include /Memory/.\n" +
      "Path protocol: Desktop/<scope>/Memory/<bucket>/<subpath>\n" +
      "Buckets: user, note. Scopes: Desktop, Canvas, Logo, VibeCoding.\n\n" +
      "Namespace:\n" +
      NAMESPACE_TREE,
    inputSchema: z.object({
      userId: userIdSchema.optional(),
      path: z.string().describe("Directory path, e.g. Desktop/Canvas/Memory/user"),
      limit: z.number().int().min(1).max(200).optional().describe("Max entries, default 50"),
    }),
    execute: async ({ userId: _u, path, limit }, _context) => {
      assertMemoryPath(path)
      const uid = getUserId({ userId: _u })
      const nodes = await afs.list(uid, path, { limit: limit ?? 50 })
      return { ok: true, path, count: nodes.length, nodes }
    },
  }),

  afs_mcp_memory_read: createTool({
    id: "afs_mcp_memory_read",
    description:
      "Read a single memory node by full path. Path must include /Memory/.\n" +
      "Example: Desktop/Canvas/Memory/user/profile",
    inputSchema: z.object({
      userId: userIdSchema.optional(),
      path: z.string().describe("Full path, e.g. Desktop/Memory/user/morning-design-preference"),
    }),
    execute: async ({ userId: _u, path }, _context) => {
      assertMemoryPath(path)
      const uid = getUserId({ userId: _u })
      const node = await afs.read(uid, path)
      if (!node) return { ok: false, error: `Node not found: ${path}` }
      return { ok: true, node }
    },
  }),

  afs_mcp_memory_write: createTool({
    id: "afs_mcp_memory_write",
    description:
      "Write a memory entry. Path must include /Memory/. Buckets: user, note.\n" +
      "Existing entries at same path are merged (deduplication).",
    inputSchema: z.object({
      userId: userIdSchema.optional(),
      path: z.string().describe("Target path, e.g. Desktop/Memory/user/prefers-morning-design"),
      content: z.string().describe("Memory content text"),
      tags: z.array(z.string()).optional(),
      confidence: z.number().int().min(0).max(100).optional().describe("0-100, default 80"),
    }),
    execute: async ({ userId: _u, path, content, tags, confidence }, _context) => {
      assertMemoryPath(path)
      const uid = getUserId({ userId: _u })
      try {
        const node = await afs.write(uid, path, content, {
          tags,
          confidence,
          sourceType: "prediction_agent",
        })
        return { ok: true, node }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Failed to write" }
      }
    },
  }),

  afs_mcp_memory_search: createTool({
    id: "afs_mcp_memory_search",
    description:
      "Search AFS Memory. Use mode=exact for keyword; mode=semantic requires pathPrefix (Memory subtree).",
    inputSchema: z
      .object({
        userId: userIdSchema.optional(),
        query: z.string().describe("Keyword to search for"),
        mode: z.enum(["exact", "semantic"]).default("exact"),
        scope: z.string().optional(),
        pathPrefix: z.string().optional().describe("Required for semantic mode, e.g. Desktop/Canvas/Memory/note"),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
      })
      .superRefine((v, ctx) => {
        if (v.mode === "semantic" && !v.pathPrefix) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pathPrefix"], message: "pathPrefix required for semantic mode" })
        }
        if (v.pathPrefix && !v.pathPrefix.includes("/Memory/")) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pathPrefix"], message: "pathPrefix must include /Memory/" })
        }
      }),
    execute: async ({ userId: _u, query, mode, scope, pathPrefix, limit }, _context) => {
      const uid = getUserId({ userId: _u })
      const results = await afs.search(uid, query, {
        mode,
        scope,
        pathPrefix: pathPrefix ?? undefined,
        limit: limit ?? 20,
      })
      return { ok: true, count: results.length, results }
    },
  }),

  afs_mcp_memory_delete: createTool({
    id: "afs_mcp_memory_delete",
    description: "Soft-delete a memory node. Path must include /Memory/.",
    inputSchema: z.object({
      userId: userIdSchema.optional(),
      path: z.string().describe("Full path of the memory node to delete"),
    }),
    execute: async ({ userId: _u, path }, _context) => {
      assertMemoryPath(path)
      const uid = getUserId({ userId: _u })
      try {
        const deleted = await afs.delete(uid, path)
        if (!deleted) return { ok: false, error: `Node not found: ${path}` }
        return { ok: true, deleted: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Failed to delete" }
      }
    },
  }),
}
