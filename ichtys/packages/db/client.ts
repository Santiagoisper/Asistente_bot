import './ensure-ws-env'
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
 *
 * Local dev: `ensure-ws-env` desactiva bufferutil antes de cargar `ws`.
 *
 * Inicialización perezosa (lazy): el Pool se crea en el primer uso, no al
 * importar el módulo. Sin esto, `next build` falla al recolectar datos de
 * páginas que importan `@ichtys/db` en entornos de build sin DATABASE_URL.
 * Si en runtime falta la variable, el error aparece en el primer acceso a `db`
 * con el mismo mensaje de siempre.
 */

if (!neonConfig.webSocketConstructor) {
  neonConfig.webSocketConstructor = ws
}

function createDb(pool: Pool) {
  return drizzle(pool, { schema })
}

export type Database = ReturnType<typeof createDb>

let poolInstance: Pool | null = null
let dbInstance: Database | null = null

function getPool(): Pool {
  if (poolInstance) return poolInstance
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. See .env.example.')
  }
  poolInstance = new Pool({ connectionString })
  return poolInstance
}

function getDb(): Database {
  if (!dbInstance) dbInstance = createDb(getPool())
  return dbInstance
}

/**
 * Proxy que crea el cliente real en el primer acceso. Se mantiene la misma API
 * (`db.select`, `db.query.*`, `db.transaction`, …) y el mismo tipo `Database`.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const instance = getDb()
    const value = Reflect.get(instance as object, prop, instance)
    return typeof value === 'function' ? value.bind(instance) : value
  },
  has(_target, prop) {
    return prop in getDb()
  },
})

/** Pool subyacente, creado también en el primer uso. */
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const instance = getPool()
    const value = Reflect.get(instance as object, prop, instance)
    return typeof value === 'function' ? value.bind(instance) : value
  },
  has(_target, prop) {
    return prop in getPool()
  },
})

export { schema }
