import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import ws from 'ws'
import * as schema from './schema'

/**
 * Cliente Drizzle sobre Neon Postgres (@neondatabase/serverless).
 *
 * - Runtime usa DATABASE_URL (pooled) con connection pooling vía Pool/WebSocket.
 * - Las migrations usan DATABASE_URL_UNPOOLED (conexión directa); ver
 *   drizzle.config.ts.
 *
 * En entornos Node (no edge) el driver necesita un WebSocket constructor:
 * se inyecta `ws`. En edge/Vercel el runtime ya provee WebSocket nativo.
 */
if (!neonConfig.webSocketConstructor) {
  neonConfig.webSocketConstructor = ws
}

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. See .env.example.')
}

const pool = new Pool({ connectionString })

export const db = drizzle(pool, { schema })

export type Database = typeof db
export { pool, schema }
