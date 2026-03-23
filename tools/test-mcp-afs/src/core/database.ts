import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { serverConfig } from "@/core/config"
import * as schema from "@/db/schema"

export const pool = new Pool({
  connectionString: serverConfig.database.url,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
})

export const db = drizzle(pool, {
  schema,
})
