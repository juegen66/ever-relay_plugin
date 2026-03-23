import { randomUUID } from "node:crypto"

import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm"

import { db } from "@/core/database"
import {
  AFS_HISTORY_BUCKETS,
  AFS_MEMORY_BUCKETS,
  AFS_SCOPES,
  afsHistory,
  afsMemory,
  afsMemoryEmbeddings,
  afsSkill,
  type AfsHistoryBucket,
  type AfsMemoryBucket,
  type AfsScope,
  type AfsSourceType,
} from "@/db/schema"

import { afsEmbeddingService } from "./embeddings"

import type {
  AfsKind,
  AfsListOptions,
  AfsNode,
  AfsSearchOptions,
  AfsTransaction,
  AfsWriteOptions,
  ParsedPath,
} from "./types"

// ---------------------------------------------------------------------------
// AFS v2 — Unified path-based Agentic File System
//
// No modules. Path is parsed into (scope, kind, bucket, subpath, name)
// and translated directly into database queries.
//
// Desktop is the root. It sees everything.
// Sub-apps are scoped: Desktop/Canvas/..., Desktop/Logo/..., etc.
// ---------------------------------------------------------------------------

const VALID_SCOPES = new Set<string>(AFS_SCOPES)
const VALID_KINDS = new Set<string>(["Memory", "History", "Skill"])
const VALID_MEMORY_BUCKETS = new Set<string>(AFS_MEMORY_BUCKETS)

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)
}

export class AFS {
  private readonly txLog: AfsTransaction[] = []
  private txSink?: (tx: AfsTransaction) => void | Promise<void>

  onTransaction(sink: (tx: AfsTransaction) => void | Promise<void>): this {
    this.txSink = sink
    return this
  }

  // -----------------------------------------------------------------------
  // Path parsing
  // -----------------------------------------------------------------------

  parsePath(raw: string): ParsedPath {
    const segments = raw.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean)

    // Remove leading "Desktop" if present
    if (segments[0]?.toLowerCase() === "desktop") {
      segments.shift()
    }

    const result: ParsedPath = {
      scope: "Desktop",
      kind: null,
      bucket: null,
      subpath: "/",
      name: null,
      depth: 0,
    }

    if (segments.length === 0) {
      result.depth = 0
      return result
    }

    let idx = 0

    // Check if first segment is a sub-app scope
    if (VALID_SCOPES.has(segments[0]) && segments[0] !== "Desktop") {
      result.scope = segments[0] as AfsScope
      idx++
    }

    result.depth = 1 // at scope level

    // Kind: Memory, History, or Skill
    if (idx < segments.length) {
      const kindRaw = segments[idx]
      if (VALID_KINDS.has(kindRaw)) {
        result.kind = kindRaw.toLowerCase() as AfsKind
        idx++
        result.depth = 2
      } else {
        return result
      }
    } else {
      return result
    }

    // Skill has no bucket; next segment is the name directly
    if (result.kind === "skill") {
      if (idx < segments.length) {
        result.name = segments[idx]
        result.depth = 3
      }
      return result
    }

    // Bucket
    if (idx < segments.length) {
      result.bucket = segments[idx]
      idx++
      result.depth = 3
    } else {
      return result
    }

    // Remaining: subpath + name
    if (idx < segments.length) {
      const remaining = segments.slice(idx)
      if (remaining.length === 1) {
        result.name = remaining[0]
        result.depth = 4
      } else {
        result.name = remaining[remaining.length - 1]
        result.subpath = "/" + remaining.slice(0, -1).join("/")
        result.depth = 4
      }
    }

    return result
  }

  buildPath(parsed: ParsedPath): string {
    const parts = ["Desktop"]
    if (parsed.scope !== "Desktop") parts.push(parsed.scope)
    if (parsed.kind) {
      if (parsed.kind === "skill") {
        parts.push("Skill")
      } else {
        parts.push(parsed.kind === "memory" ? "Memory" : "History")
      }
    }
    if (parsed.kind !== "skill" && parsed.bucket) parts.push(parsed.bucket)
    if (parsed.subpath && parsed.subpath !== "/") {
      parts.push(...parsed.subpath.replace(/^\//, "").split("/"))
    }
    if (parsed.name) parts.push(parsed.name)
    return parts.join("/")
  }

  // -----------------------------------------------------------------------
  // Namespace tree
  // -----------------------------------------------------------------------

  getNamespaceTree(): string {
    const lines: string[] = ["Desktop/"]
    for (const scope of AFS_SCOPES) {
      if (scope === "Desktop") continue
      lines.push(`  ${scope}/`)
      lines.push(`    Memory/`)
      for (const b of AFS_MEMORY_BUCKETS) lines.push(`      ${b}/`)
      lines.push(`    History/`)
      for (const b of AFS_HISTORY_BUCKETS) lines.push(`      ${b}/`)
      lines.push(`    Skill/`)
    }
    lines.push(`  Memory/  (global)`)
    for (const b of AFS_MEMORY_BUCKETS) lines.push(`    ${b}/`)
    lines.push(`  History/  (global)`)
    for (const b of AFS_HISTORY_BUCKETS) lines.push(`    ${b}/`)
    lines.push(`  Skill/  (global)`)
    return lines.join("\n")
  }

  // -----------------------------------------------------------------------
  // List
  // -----------------------------------------------------------------------

  async list(userId: string, path: string, options?: AfsListOptions): Promise<AfsNode[]> {
    const parsed = this.parsePath(path)
    const limit = options?.limit ?? 50

    // depth 0: Desktop root → list scopes
    if (parsed.depth === 0) {
      const scopes = AFS_SCOPES.filter((s) => s !== "Desktop")
      return [
        ...scopes.map((s) => this.dirNode(`Desktop/${s}`, s)),
        this.dirNode("Desktop/Memory", "Memory"),
        this.dirNode("Desktop/History", "History"),
        this.dirNode("Desktop/Skill", "Skill"),
      ]
    }

    // depth 1: scope → list kinds
    if (parsed.depth === 1 && !parsed.kind) {
      const prefix = parsed.scope === "Desktop" ? "Desktop" : `Desktop/${parsed.scope}`
      return [
        this.dirNode(`${prefix}/Memory`, "Memory"),
        this.dirNode(`${prefix}/History`, "History"),
        this.dirNode(`${prefix}/Skill`, "Skill"),
      ]
    }

    // depth 2: kind → list buckets (or list skills)
    if (parsed.depth === 2 && !parsed.bucket) {
      if (parsed.kind === "skill") {
        return this.listSkills(userId, parsed, limit)
      }
      const prefix = parsed.scope === "Desktop" ? "Desktop" : `Desktop/${parsed.scope}`
      const kindLabel = parsed.kind === "memory" ? "Memory" : "History"
      const buckets = parsed.kind === "memory" ? AFS_MEMORY_BUCKETS : AFS_HISTORY_BUCKETS
      return buckets.map((b) => this.dirNode(`${prefix}/${kindLabel}/${b}`, b))
    }

    // depth 3+: bucket level → query DB
    if (parsed.kind === "memory") {
      return this.listMemory(userId, parsed, limit)
    }

    if (parsed.kind === "history") {
      return this.listHistory(userId, parsed, limit)
    }

    return []
  }

  private async listMemory(userId: string, parsed: ParsedPath, limit: number): Promise<AfsNode[]> {
    const conditions = [
      eq(afsMemory.userId, userId),
      eq(afsMemory.scope, parsed.scope),
      isNull(afsMemory.deletedAt),
    ]

    if (parsed.bucket) {
      conditions.push(eq(afsMemory.bucket, parsed.bucket as AfsMemoryBucket))
    }

    if (parsed.subpath && parsed.subpath !== "/") {
      conditions.push(eq(afsMemory.path, parsed.subpath))
    }

    const rows = await db
      .select()
      .from(afsMemory)
      .where(and(...conditions))
      .orderBy(desc(afsMemory.confidence), desc(afsMemory.updatedAt))
      .limit(limit)

    return rows.map((r) => this.memoryToNode(r))
  }

  private async listHistory(userId: string, parsed: ParsedPath, limit: number): Promise<AfsNode[]> {
    const conditions = [
      eq(afsHistory.userId, userId),
      eq(afsHistory.scope, parsed.scope),
    ]

    if (parsed.bucket) {
      conditions.push(eq(afsHistory.bucket, parsed.bucket as AfsHistoryBucket))
    }

    const rows = await db
      .select()
      .from(afsHistory)
      .where(and(...conditions))
      .orderBy(desc(afsHistory.createdAt))
      .limit(limit)

    return rows.map((r) => this.historyToNode(r))
  }

  private async listSkills(userId: string, parsed: ParsedPath, limit: number): Promise<AfsNode[]> {
    const conditions = [
      eq(afsSkill.userId, userId),
      eq(afsSkill.scope, parsed.scope),
      eq(afsSkill.isActive, true),
    ]

    const rows = await db
      .select()
      .from(afsSkill)
      .where(and(...conditions))
      .orderBy(desc(afsSkill.priority), desc(afsSkill.updatedAt))
      .limit(limit)

    return rows.map((r) => this.skillToNode(r))
  }

  // -----------------------------------------------------------------------
  // Read
  // -----------------------------------------------------------------------

  async read(userId: string, path: string): Promise<AfsNode | null> {
    const parsed = this.parsePath(path)

    if (parsed.kind === "skill" && parsed.name) {
      return this.readSkill(userId, parsed)
    }

    if (!parsed.kind || !parsed.bucket || !parsed.name) return null

    if (parsed.kind === "memory") {
      return this.readMemory(userId, parsed)
    }

    if (parsed.kind === "history") {
      return this.readHistory(userId, parsed)
    }

    return null
  }

  private async readMemory(userId: string, parsed: ParsedPath): Promise<AfsNode | null> {
    const row = await db.query.afsMemory.findFirst({
      where: and(
        eq(afsMemory.userId, userId),
        eq(afsMemory.scope, parsed.scope),
        eq(afsMemory.bucket, parsed.bucket as AfsMemoryBucket),
        eq(afsMemory.path, parsed.subpath),
        eq(afsMemory.name, parsed.name!),
        isNull(afsMemory.deletedAt)
      ),
    })

    if (!row) return null

    await db
      .update(afsMemory)
      .set({ accessCount: row.accessCount + 1, lastAccessedAt: new Date() })
      .where(eq(afsMemory.id, row.id))

    return this.memoryToNode(row)
  }

  private async readHistory(userId: string, parsed: ParsedPath): Promise<AfsNode | null> {
    const row = await db.query.afsHistory.findFirst({
      where: and(
        eq(afsHistory.userId, userId),
        eq(afsHistory.scope, parsed.scope),
        eq(afsHistory.bucket, parsed.bucket as AfsHistoryBucket),
        eq(afsHistory.name, parsed.name!)
      ),
    })

    if (!row) return null
    return this.historyToNode(row)
  }

  private async readSkill(userId: string, parsed: ParsedPath): Promise<AfsNode | null> {
    if (!parsed.name) return null

    const row = await db.query.afsSkill.findFirst({
      where: and(
        eq(afsSkill.userId, userId),
        eq(afsSkill.scope, parsed.scope),
        eq(afsSkill.name, parsed.name),
        eq(afsSkill.isActive, true),
      ),
    })

    if (!row) return null
    return this.skillToNode(row)
  }

  // -----------------------------------------------------------------------
  // Write (memory + skill)
  // -----------------------------------------------------------------------

  async write(userId: string, path: string, content: string, options?: AfsWriteOptions): Promise<AfsNode> {
    const parsed = this.parsePath(path)

    if (parsed.kind === "skill" && parsed.name) {
      return this.writeSkill(userId, parsed, content, options)
    }

    if (parsed.kind !== "memory") {
      throw new Error(`AFS: only Memory and Skill are writable. Got path "${path}"`)
    }

    if (!parsed.bucket || !VALID_MEMORY_BUCKETS.has(parsed.bucket)) {
      throw new Error(`AFS: invalid memory bucket in path "${path}". Must be one of: ${[...VALID_MEMORY_BUCKETS].join(", ")}`)
    }

    const name = parsed.name ?? slugify(content.slice(0, 80))
    const subpath = parsed.subpath

    // Deduplication: check for existing entry
    const existing = await db.query.afsMemory.findFirst({
      where: and(
        eq(afsMemory.userId, userId),
        eq(afsMemory.scope, parsed.scope),
        eq(afsMemory.bucket, parsed.bucket as AfsMemoryBucket),
        eq(afsMemory.path, subpath),
        eq(afsMemory.name, name),
        isNull(afsMemory.deletedAt)
      ),
    })

    if (existing) {
      const newConfidence = Math.min(100, Math.max(existing.confidence, options?.confidence ?? 80) + 5)
      const merged = `${existing.content}\n---\n${content}`
      const mergedTags = Array.from(new Set([...(existing.tags ?? []), ...(options?.tags ?? [])]))
      const mergedMetadata = {
        ...(existing.metadata ?? {}),
        ...(options?.metadata ?? {}),
      }

      const [updated] = await db
        .update(afsMemory)
        .set({
          content: merged,
          confidence: newConfidence,
          tags: mergedTags,
          metadata: mergedMetadata,
          accessCount: existing.accessCount + 1,
          lastAccessedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(afsMemory.id, existing.id))
        .returning()

      await afsEmbeddingService.markMemoryEmbeddingStale(updated.id)
      await this.recordTx(userId, "write", path, { merged: true })
      return this.memoryToNode(updated)
    }

    const [entry] = await db
      .insert(afsMemory)
      .values({
        userId,
        scope: parsed.scope,
        bucket: parsed.bucket as AfsMemoryBucket,
        path: subpath,
        name,
        content,
        confidence: options?.confidence ?? 80,
        sourceType: (options?.sourceType as AfsSourceType) ?? "prediction_agent",
        tags: options?.tags ?? [],
        metadata: options?.metadata ?? {},
      })
      .returning()

    await this.recordTx(userId, "write", path)
    return this.memoryToNode(entry)
  }

  private async writeSkill(
    userId: string,
    parsed: ParsedPath,
    content: string,
    options?: AfsWriteOptions
  ): Promise<AfsNode> {
    const { afsSkillService } = await import("./skill")

    const description = (options?.metadata?.description as string) ?? parsed.name ?? "No description"
    const triggerWhen = (options?.metadata?.triggerWhen as string) ?? null
    const agentId = (options?.metadata?.agentId as string) ?? null
    const priority = typeof options?.metadata?.priority === "number" ? options.metadata.priority : 0

    const row = await afsSkillService.upsertSkill(userId, {
      agentId,
      scope: parsed.scope,
      name: parsed.name!,
      description,
      triggerWhen,
      tags: options?.tags,
      content,
      priority,
      metadata: options?.metadata,
    })

    await this.recordTx(userId, "write", this.buildPath(parsed), { kind: "skill" })
    return this.skillToNode(row)
  }

  // -----------------------------------------------------------------------
  // Delete (memory + skill)
  // -----------------------------------------------------------------------

  async delete(userId: string, path: string): Promise<boolean> {
    const parsed = this.parsePath(path)

    if (parsed.kind === "skill" && parsed.name) {
      return this.deleteSkill(userId, parsed)
    }

    if (parsed.kind !== "memory") {
      throw new Error(`AFS: only Memory and Skill are deletable. Got path "${path}"`)
    }

    if (!parsed.name) return false

    const result = await db
      .update(afsMemory)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(afsMemory.userId, userId),
          eq(afsMemory.scope, parsed.scope),
          eq(afsMemory.bucket, parsed.bucket as AfsMemoryBucket),
          eq(afsMemory.path, parsed.subpath),
          eq(afsMemory.name, parsed.name),
          isNull(afsMemory.deletedAt)
        )
      )
      .returning()

    if (result.length > 0) {
      await afsEmbeddingService.markMemoryEmbeddingStale(result[0].id)
    }

    await this.recordTx(userId, "delete", path)
    return result.length > 0
  }

  private async deleteSkill(userId: string, parsed: ParsedPath): Promise<boolean> {
    if (!parsed.name) return false

    const row = await db.query.afsSkill.findFirst({
      where: and(
        eq(afsSkill.userId, userId),
        eq(afsSkill.scope, parsed.scope),
        eq(afsSkill.name, parsed.name),
      ),
    })

    if (!row) return false

    await db.update(afsSkill).set({ isActive: false, updatedAt: new Date() }).where(eq(afsSkill.id, row.id))
    await this.recordTx(userId, "delete", this.buildPath(parsed), { kind: "skill", skillId: row.id })
    return true
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  async search(userId: string, query: string, options?: AfsSearchOptions): Promise<AfsNode[]> {
    const mode = options?.mode ?? "exact"

    if (mode === "semantic") {
      return this.searchSemantic(userId, query, options)
    }

    return this.searchExact(userId, query, options)
  }

  private async searchExact(userId: string, query: string, options?: AfsSearchOptions): Promise<AfsNode[]> {
    const limit = options?.limit ?? 20
    const pattern = `%${query}%`
    const normalizedPrefix = options?.pathPrefix ? this.normalizePathPrefix(options.pathPrefix) : undefined

    let scopeFilter: AfsScope | undefined
    if (options?.scope) {
      const scopeParsed = this.parsePath(options.scope)
      if (scopeParsed.scope !== "Desktop") {
        scopeFilter = scopeParsed.scope
      }
    }
    const prefixScope = normalizedPrefix ? this.extractScopeFromPrefix(normalizedPrefix) : undefined
    if (!scopeFilter && prefixScope && prefixScope !== "Desktop") {
      scopeFilter = prefixScope
    }

    // Search memory
    const memConditions = [
      eq(afsMemory.userId, userId),
      isNull(afsMemory.deletedAt),
      ilike(afsMemory.content, pattern),
    ]
    if (scopeFilter) memConditions.push(eq(afsMemory.scope, scopeFilter))
    if (normalizedPrefix) {
      memConditions.push(this.pathPrefixCondition(this.memoryFullPathExpr(), normalizedPrefix))
    }

    const memRows = await db
      .select()
      .from(afsMemory)
      .where(and(...memConditions))
      .orderBy(desc(afsMemory.confidence), desc(afsMemory.updatedAt))
      .limit(limit)

    // Search history
    const histConditions = [
      eq(afsHistory.userId, userId),
      ilike(afsHistory.content, pattern),
    ]
    if (scopeFilter) histConditions.push(eq(afsHistory.scope, scopeFilter))
    if (normalizedPrefix) {
      histConditions.push(this.pathPrefixCondition(this.historyFullPathExpr(), normalizedPrefix))
    }

    const histRows = await db
      .select()
      .from(afsHistory)
      .where(and(...histConditions))
      .orderBy(desc(afsHistory.createdAt))
      .limit(limit)

    // Search skills
    const skillConditions = [
      eq(afsSkill.userId, userId),
      eq(afsSkill.isActive, true),
      or(
        ilike(afsSkill.name, pattern),
        ilike(afsSkill.content, pattern),
        ilike(afsSkill.description, pattern),
      ),
    ]
    if (scopeFilter) skillConditions.push(eq(afsSkill.scope, scopeFilter))

    const skillRows = await db
      .select()
      .from(afsSkill)
      .where(and(...skillConditions))
      .limit(limit)

    // Bump access counts for memory results
    if (memRows.length > 0) {
      await db
        .update(afsMemory)
        .set({
          accessCount: sql`${afsMemory.accessCount} + 1`,
          lastAccessedAt: new Date(),
        })
        .where(inArray(afsMemory.id, memRows.map((r) => r.id)))
    }

    await this.recordTx(userId, "search", "/", {
      query,
      mode: "exact",
      pathPrefix: normalizedPrefix,
      resultCount: memRows.length + histRows.length + skillRows.length,
    })

    return [
      ...memRows.map((r) => this.memoryToNode(r)),
      ...histRows.map((r) => this.historyToNode(r)),
      ...skillRows.map((r) => this.skillToNode(r)),
    ]
  }

  private async searchSemantic(userId: string, query: string, options?: AfsSearchOptions): Promise<AfsNode[]> {
    const limit = options?.limit ?? 20
    const normalizedPrefix = this.requireSemanticPathPrefix(options?.pathPrefix)
    const scopeFilter = this.resolveSemanticScope(options?.scope, normalizedPrefix)
    const queryEmbedding = await afsEmbeddingService.embedText(query)
    const queryVector = `[${queryEmbedding.vector.join(",")}]`
    const distanceExpr = sql<number>`${afsMemoryEmbeddings.embedding} <=> ${queryVector}::vector`

    const rows = await db
      .select({
        memory: afsMemory,
        distance: distanceExpr,
      })
      .from(afsMemoryEmbeddings)
      .innerJoin(afsMemory, eq(afsMemoryEmbeddings.memoryId, afsMemory.id))
      .where(and(
        eq(afsMemoryEmbeddings.userId, userId),
        isNull(afsMemoryEmbeddings.staleAt),
        isNull(afsMemory.deletedAt),
        scopeFilter ? eq(afsMemory.scope, scopeFilter) : undefined,
        this.pathPrefixCondition(this.memoryFullPathExpr(), normalizedPrefix)
      ))
      .orderBy(distanceExpr, desc(afsMemory.confidence), desc(afsMemory.updatedAt))
      .limit(limit)

    if (rows.length > 0) {
      await db
        .update(afsMemory)
        .set({
          accessCount: sql`${afsMemory.accessCount} + 1`,
          lastAccessedAt: new Date(),
        })
        .where(inArray(afsMemory.id, rows.map((row) => row.memory.id)))
    }

    await this.recordTx(userId, "search", "/", {
      query,
      mode: "semantic",
      pathPrefix: normalizedPrefix,
      resultCount: rows.length,
    })

    return rows.map((row) => this.memoryToNode(row.memory))
  }

  // -----------------------------------------------------------------------
  // History append (for action logging)
  // -----------------------------------------------------------------------

  async appendHistory(
    userId: string,
    scope: AfsScope,
    bucket: AfsHistoryBucket,
    name: string,
    content: string,
    options?: { actionType?: string; status?: string; metadata?: Record<string, unknown>; path?: string }
  ): Promise<AfsNode> {
    const [row] = await db
      .insert(afsHistory)
      .values({
        userId,
        scope,
        bucket,
        path: options?.path ?? "/",
        name,
        content,
        actionType: options?.actionType,
        status: options?.status,
        metadata: options?.metadata ?? {},
      })
      .returning()

    return this.historyToNode(row)
  }

  // -----------------------------------------------------------------------
  // Transaction log
  // -----------------------------------------------------------------------

  getRecentTransactions(limit = 50): AfsTransaction[] {
    return this.txLog.slice(-limit)
  }

  // -----------------------------------------------------------------------
  // Node converters
  // -----------------------------------------------------------------------

  private memoryToNode(row: typeof afsMemory.$inferSelect): AfsNode {
    const pathParts = ["Desktop"]
    if (row.scope !== "Desktop") pathParts.push(row.scope)
    pathParts.push("Memory", row.bucket)
    if (row.path && row.path !== "/") pathParts.push(...row.path.replace(/^\//, "").split("/"))
    pathParts.push(row.name)

    return {
      path: pathParts.join("/"),
      name: row.name,
      type: "file",
      content: row.content,
      metadata: {
        confidence: row.confidence,
        sourceType: row.sourceType,
        tags: row.tags,
        accessCount: row.accessCount,
        scope: row.scope,
        bucket: row.bucket,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        contentType: `afs/memory-${row.bucket}`,
        ...row.metadata,
      },
    }
  }

  private historyToNode(row: typeof afsHistory.$inferSelect): AfsNode {
    const pathParts = ["Desktop"]
    if (row.scope !== "Desktop") pathParts.push(row.scope)
    pathParts.push("History", row.bucket)
    if (row.path && row.path !== "/") pathParts.push(...row.path.replace(/^\//, "").split("/"))
    pathParts.push(row.name)

    return {
      path: pathParts.join("/"),
      name: row.name,
      type: "file",
      content: row.content,
      metadata: {
        scope: row.scope,
        bucket: row.bucket,
        actionType: row.actionType ?? undefined,
        status: row.status ?? undefined,
        createdAt: row.createdAt.toISOString(),
        contentType: `afs/history-${row.bucket}`,
        ...row.metadata,
      },
    }
  }

  private skillToNode(row: typeof afsSkill.$inferSelect): AfsNode {
    const pathParts = ["Desktop"]
    if (row.scope !== "Desktop") pathParts.push(row.scope)
    pathParts.push("Skill", row.name)

    return {
      path: pathParts.join("/"),
      name: row.name,
      type: "file",
      content: row.content,
      metadata: {
        scope: row.scope,
        agentId: row.agentId,
        description: row.description,
        triggerWhen: row.triggerWhen,
        tags: row.tags,
        version: row.version,
        isActive: row.isActive,
        priority: row.priority,
        contentType: "afs/skill",
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        ...row.metadata,
      },
    }
  }

  private dirNode(path: string, name: string): AfsNode {
    return { path, name, type: "dir", metadata: {} }
  }

  private normalizePathPrefix(raw: string) {
    return raw.replace(/^\/+|\/+$/g, "")
  }

  private requireSemanticPathPrefix(pathPrefix?: string) {
    if (!pathPrefix) {
      throw new Error("AFS: semantic search requires pathPrefix")
    }

    const normalized = this.normalizePathPrefix(pathPrefix)
    const parsed = this.parsePath(normalized)
    if (parsed.kind !== "memory") {
      throw new Error(`AFS: semantic search pathPrefix must point to a Memory subtree. Got "${pathPrefix}"`)
    }

    return normalized
  }

  private extractScopeFromPrefix(pathPrefix: string): AfsScope {
    return this.parsePath(pathPrefix).scope
  }

  private resolveSemanticScope(scope: string | undefined, pathPrefix: string): AfsScope | undefined {
    const prefixScope = this.extractScopeFromPrefix(pathPrefix)
    if (!scope) {
      return prefixScope === "Desktop" ? undefined : prefixScope
    }

    const parsedScope = this.parsePath(scope).scope
    if (parsedScope !== prefixScope) {
      throw new Error(`AFS: semantic search scope "${scope}" conflicts with pathPrefix "${pathPrefix}"`)
    }

    return parsedScope === "Desktop" ? undefined : parsedScope
  }

  private memoryFullPathExpr() {
    return sql<string>`concat(
      'Desktop',
      case when ${afsMemory.scope} <> 'Desktop' then '/' || ${afsMemory.scope} else '' end,
      '/Memory/',
      ${afsMemory.bucket},
      case when ${afsMemory.path} <> '/' then ${afsMemory.path} else '' end,
      '/',
      ${afsMemory.name}
    )`
  }

  private historyFullPathExpr() {
    return sql<string>`concat(
      'Desktop',
      case when ${afsHistory.scope} <> 'Desktop' then '/' || ${afsHistory.scope} else '' end,
      '/History/',
      ${afsHistory.bucket},
      case when ${afsHistory.path} <> '/' then ${afsHistory.path} else '' end,
      '/',
      ${afsHistory.name}
    )`
  }

  private pathPrefixCondition(pathExpr: ReturnType<typeof sql<string>>, normalizedPrefix: string) {
    return or(
      sql`${pathExpr} = ${normalizedPrefix}`,
      ilike(pathExpr, `${normalizedPrefix}/%`)
    )!
  }

  private async recordTx(
    actor: string,
    operation: AfsTransaction["operation"],
    path: string,
    detail?: Record<string, unknown>
  ) {
    const tx: AfsTransaction = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      actor,
      operation,
      path,
      detail,
    }

    this.txLog.push(tx)
    if (this.txLog.length > 1000) {
      this.txLog.splice(0, this.txLog.length - 1000)
    }

    if (this.txSink) {
      try { await this.txSink(tx) } catch { /* non-critical */ }
    }
  }
}
