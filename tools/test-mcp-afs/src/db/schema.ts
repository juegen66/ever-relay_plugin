import { sql } from "drizzle-orm"
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

// ---------------------------------------------------------------------------
// AFS v2 — Unified path-based file system
//
// Two tables: afs_memory (writable) + afs_history (append-only)
// Path protocol: Desktop/<scope>/<kind>/<bucket>/<subpath>/<name>
// ---------------------------------------------------------------------------

export const AFS_SCOPES = ["Desktop", "Canvas", "Logo", "VibeCoding"] as const
export type AfsScope = (typeof AFS_SCOPES)[number]

export const AFS_MEMORY_BUCKETS = ["user", "note"] as const
export type AfsMemoryBucket = (typeof AFS_MEMORY_BUCKETS)[number]

export const AFS_HISTORY_BUCKETS = ["actions", "sessions", "prediction-runs", "workflow-runs", "canvas-activity"] as const
export type AfsHistoryBucket = (typeof AFS_HISTORY_BUCKETS)[number]

export const AFS_SOURCE_TYPES = ["prediction_agent", "workflow_curator", "manual", "system"] as const
export type AfsSourceType = (typeof AFS_SOURCE_TYPES)[number]

export const AFS_INGEST_CHECKPOINT_STATUSES = ["idle", "running", "completed", "failed"] as const
export type AfsIngestCheckpointStatus = (typeof AFS_INGEST_CHECKPOINT_STATUSES)[number]

const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`
  },
  toDriver(value) {
    return `[${value.join(",")}]`
  },
  fromDriver(value) {
    if (typeof value !== "string") return value as number[]
    const trimmed = value.trim().replace(/^\[/, "").replace(/\]$/, "")
    if (!trimmed) return []
    return trimmed.split(",").map((part) => Number(part.trim()))
  },
})

export const afsMemory = pgTable(
  "afs_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    scope: text("scope").$type<AfsScope>().notNull().default("Desktop"),
    bucket: text("bucket").$type<AfsMemoryBucket>().notNull().default("user"),
    path: text("path").notNull().default("/"),
    name: text("name").notNull(),
    content: text("content").notNull(),
    contentType: text("content_type"),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    confidence: integer("confidence").notNull().default(80),
    sourceType: text("source_type").$type<AfsSourceType>().notNull().default("prediction_agent"),
    accessCount: integer("access_count").notNull().default(0),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userScopeBucketIdx: index("afs_memory_user_scope_bucket_idx").on(table.userId, table.scope, table.bucket),
    userScopeBucketPathNameIdx: uniqueIndex("afs_memory_user_scope_bucket_path_name_idx").on(
      table.userId, table.scope, table.bucket, table.path, table.name
    ),
    userConfidenceIdx: index("afs_memory_user_confidence_idx").on(table.userId, table.confidence),
    deletedIdx: index("afs_memory_deleted_idx").on(table.deletedAt),
  })
)

export type AfsMemoryRow = typeof afsMemory.$inferSelect

export const afsHistory = pgTable(
  "afs_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    scope: text("scope").$type<AfsScope>().notNull().default("Desktop"),
    bucket: text("bucket").$type<AfsHistoryBucket>().notNull().default("actions"),
    path: text("path").notNull().default("/"),
    name: text("name").notNull(),
    actionType: text("action_type"),
    content: text("content").notNull(),
    status: text("status"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userScopeBucketCreatedIdx: index("afs_history_user_scope_bucket_created_idx").on(
      table.userId, table.scope, table.bucket, table.createdAt
    ),
    userActionTypeIdx: index("afs_history_user_action_type_idx").on(table.userId, table.actionType),
  })
)

export const afsMemoryEmbeddings = pgTable(
  "afs_memory_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memoryId: uuid("memory_id").notNull().references(() => afsMemory.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    model: text("model").notNull(),
    modelVersion: text("model_version").notNull(),
    contentHash: text("content_hash").notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true }).defaultNow().notNull(),
    staleAt: timestamp("stale_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (table) => ({
    memoryIdIdx: uniqueIndex("afs_memory_embeddings_memory_id_idx").on(table.memoryId),
    userIdIdx: index("afs_memory_embeddings_user_id_idx").on(table.userId),
    staleIdx: index("afs_memory_embeddings_stale_idx").on(table.staleAt),
  })
)

export const afsIngestCheckpoints = pgTable(
  "afs_ingest_checkpoints",
  {
    userId: text("user_id").primaryKey(),
    lastIngestedAt: timestamp("last_ingested_at", { withTimezone: true }),
    lastHistoryCreatedAt: timestamp("last_history_created_at", { withTimezone: true }),
    lastHistoryId: uuid("last_history_id"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    status: text("status").$type<AfsIngestCheckpointStatus>().notNull().default("idle"),
    error: text("error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    statusUpdatedIdx: index("afs_ingest_checkpoints_status_updated_idx").on(table.status, table.updatedAt),
    lastRunIdx: index("afs_ingest_checkpoints_last_run_idx").on(table.lastRunAt),
  })
)

export const afsTransactionLogs = pgTable(
  "afs_transaction_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: text("actor").notNull(),
    operation: text("operation").notNull(),
    path: text("path").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    actorCreatedIdx: index("afs_tx_logs_actor_created_idx").on(table.actor, table.createdAt),
    pathIdx: index("afs_tx_logs_path_idx").on(table.path),
  })
)

export const afsSkill = pgTable(
  "afs_skill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    agentId: text("agent_id"),
    scope: text("scope").$type<AfsScope>().notNull().default("Desktop"),
    name: text("name").notNull(),
    description: text("description").notNull(),
    triggerWhen: text("trigger_when"),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    content: text("content").notNull(),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    priority: integer("priority").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userAgentNameIdx: uniqueIndex("afs_skill_user_agent_name_idx").on(
      table.userId, table.agentId, table.name
    ),
    userScopeActiveIdx: index("afs_skill_user_scope_active_idx").on(
      table.userId, table.scope, table.isActive
    ),
    agentActiveIdx: index("afs_skill_agent_active_idx").on(
      table.agentId, table.isActive
    ),
  })
)

export type AfsSkillRow = typeof afsSkill.$inferSelect
