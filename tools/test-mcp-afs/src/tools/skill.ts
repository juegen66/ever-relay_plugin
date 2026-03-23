import { and, eq } from "drizzle-orm"
import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import { db } from "@/core/database"
import { afsSkill } from "@/db/schema"
import { afsSkillService } from "@/afs/skill"

const userIdSchema = z.string().describe("User ID (or set AFS_MCP_USER_ID env for default)")

function getUserId(input: { userId?: string }): string {
  const uid = input.userId ?? process.env.AFS_MCP_USER_ID
  if (!uid) throw new Error("userId required (or set AFS_MCP_USER_ID env)")
  return uid
}

export const skillTools = {
  afs_mcp_skill_list: createTool({
    id: "afs_mcp_skill_list",
    description:
      "List skill metadata (without content) for a user. Optionally filter by agentId and/or scope (Desktop, Canvas, Logo, VibeCoding).",
    inputSchema: z.object({
      userId: userIdSchema.optional(),
      agentId: z.string().optional().describe("Filter by agent ID"),
      scope: z.enum(["Desktop", "Canvas", "Logo", "VibeCoding"]).optional(),
    }),
    execute: async ({ userId: _u, agentId, scope }, _context) => {
      const uid = getUserId({ userId: _u })
      const skills = await afsSkillService.listSkillMeta(uid, {
        agentId,
        scope: scope ?? undefined,
      })
      return { ok: true, count: skills.length, skills }
    },
  }),

  afs_mcp_skill_read: createTool({
    id: "afs_mcp_skill_read",
    description: "Load full skill content by ID. Verifies ownership via userId.",
    inputSchema: z.object({
      userId: userIdSchema.optional(),
      skillId: z.string().describe("Skill UUID"),
    }),
    execute: async ({ userId: _u, skillId }, _context) => {
      const uid = getUserId({ userId: _u })
      const row = await db.query.afsSkill.findFirst({
        where: and(eq(afsSkill.id, skillId), eq(afsSkill.userId, uid)),
        columns: { id: true, name: true, content: true },
      })
      if (!row) return { ok: false, error: `Skill not found or access denied: ${skillId}` }
      return { ok: true, skill: { id: row.id, name: row.name, content: row.content } }
    },
  }),

  afs_mcp_skill_upsert: createTool({
    id: "afs_mcp_skill_upsert",
    description:
      "Create or update a skill. Upserts by (userId, agentId, name). Scope: Desktop, Canvas, Logo, VibeCoding.",
    inputSchema: z.object({
      userId: userIdSchema.optional(),
      name: z.string(),
      description: z.string(),
      content: z.string(),
      agentId: z.string().nullable().optional(),
      scope: z.enum(["Desktop", "Canvas", "Logo", "VibeCoding"]).optional().default("Desktop"),
      triggerWhen: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
      priority: z.number().optional(),
    }),
    execute: async (
      { userId: _u, name, description, content, agentId, scope, triggerWhen, tags, priority },
      _context
    ) => {
      const uid = getUserId({ userId: _u })
      const row = await afsSkillService.upsertSkill(uid, {
        name,
        description,
        content,
        agentId: agentId ?? null,
        scope: scope ?? "Desktop",
        triggerWhen: triggerWhen ?? null,
        tags: tags ?? [],
        priority: priority ?? 0,
      })
      return {
        ok: true,
        skill: {
          id: row.id,
          name: row.name,
          scope: row.scope,
          version: row.version,
          updatedAt: row.updatedAt.toISOString(),
        },
      }
    },
  }),
}
