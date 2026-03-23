/**
 * Minimal config for standalone MCP AFS — database + embedding API only.
 * Load `.env` via `src/env.ts` before other modules read `process.env`.
 */
export const serverConfig = {
  database: {
    url:
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/postgres",
  },

  afsEmbedding: {
    apiKey: process.env.AFS_EMBEDDING_API_KEY ?? process.env.API_KEY,
    baseUrl:
      process.env.AFS_EMBEDDING_BASE_URL ??
      process.env.BASE_URL,
    model: process.env.AFS_EMBEDDING_MODEL,
    modelVersion: process.env.AFS_EMBEDDING_MODEL_VERSION,
    dimensions: process.env.AFS_EMBEDDING_DIMENSIONS
      ? Number(process.env.AFS_EMBEDDING_DIMENSIONS)
      : undefined,
    get enabled() {
      return Boolean(this.apiKey && this.baseUrl && this.model && this.dimensions && this.dimensions > 0)
    },
  },
} as const
