import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { config } from "dotenv"

const here = dirname(fileURLToPath(import.meta.url))
// test-mcp-afs/.env (symlink to parent repo `.env` is fine)
config({ path: resolve(here, "../.env") })
