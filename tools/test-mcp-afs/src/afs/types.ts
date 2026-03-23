// ---------------------------------------------------------------------------
// AFS v2 Type System
//
// Unified path-based file system. No modules — just path parsing + DB queries.
// Path protocol: Desktop/<scope>/<kind>/<bucket>/<subpath>/<name>
//
// Desktop is the root directory. It can access everything.
// Sub-apps (Canvas, Logo, VibeCoding) are scoped under Desktop.
// ---------------------------------------------------------------------------

import type { AfsScope, AfsMemoryBucket, AfsHistoryBucket } from "@/db/schema"

export type AfsKind = "memory" | "history" | "skill"
export type AfsSearchMode = "exact" | "semantic"

export interface ParsedPath {
  scope: AfsScope
  kind: AfsKind | null
  bucket: string | null
  subpath: string
  name: string | null
  depth: number
}

export interface AfsNode {
  path: string
  name: string
  type: "file" | "dir"
  content?: string
  metadata: AfsMetadata
}

export interface AfsMetadata {
  createdAt?: string
  updatedAt?: string
  confidence?: number
  sourceType?: string
  tags?: string[]
  accessCount?: number
  contentType?: string
  scope?: string
  bucket?: string
  actionType?: string
  status?: string
  [key: string]: unknown
}

export interface AfsListOptions {
  limit?: number
  offset?: number
}

export interface AfsWriteOptions {
  tags?: string[]
  confidence?: number
  sourceType?: string
  metadata?: Record<string, unknown>
}

export interface AfsSearchOptions {
  limit?: number
  scope?: string
  mode?: AfsSearchMode
  pathPrefix?: string
}

export interface AfsTransaction {
  id: string
  timestamp: string
  actor: string
  operation: "list" | "read" | "write" | "delete" | "search"
  path: string
  detail?: Record<string, unknown>
}
