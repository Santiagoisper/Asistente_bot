import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * Cliente Drizzle conectado a Neon Postgres (pooled).
 *
 * - Runtime usa DATABASE_URL (pooled).
 * - Las migrations usan DATABASE_URL_UNPOOLED (ver drizzle.config.ts).
 */
const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. See .env.example.')
}

// `prepare: false` es recomendado para pooled connections (PgBouncer/Neon pooler).
const queryClient = postgres(connectionString, { prepare: false })

export const db = drizzle(queryClient, { schema })

export type Database = typeof db
export { schema }
