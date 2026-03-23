import { db } from "@/core/database"
import { afsTransactionLogs } from "@/db/schema"

import { AFS } from "./afs"
import type { AfsTransaction } from "./types"

export const afs = new AFS()
  .onTransaction(async (tx: AfsTransaction) => {
    await db.insert(afsTransactionLogs).values({
      id: tx.id,
      actor: tx.actor,
      operation: tx.operation,
      path: tx.path,
      detail: tx.detail ?? null,
    })
  })

export { AFS } from "./afs"
export type { AfsNode, AfsMetadata, AfsTransaction, ParsedPath } from "./types"
