/**
 * Punto de entrada público del package @ichtys/db.
 */
export { db, schema, type Database } from './client'
export * from './schema'
// Re-export de operadores Drizzle usados por capas server-only (apps/web)
// que no deben depender directamente de drizzle-orm.
export { and, eq, inArray } from 'drizzle-orm'
