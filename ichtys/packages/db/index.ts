/**
 * Punto de entrada público del package @ichtys/db.
 */
export { db, schema, type Database } from './client'
export * from './schema'
// Re-export de operadores Drizzle usados por capas server-only (apps/web)
// que no deben depender directamente de drizzle-orm.
export { and, desc, eq, inArray, ne } from 'drizzle-orm'
export { getOrgRagConfig, updateOrgRagConfig, type ResolvedOrgRagConfig, type OrgLlmProvider } from './org-config'
export {
  getOrgLlmApiKeys,
  updateOrgLlmApiKeys,
  resolveLlmApiKey,
  getOrgLlmKeySource,
  buildOrgLlmKeyStatuses,
  maskApiKey,
  type OrgLlmApiKeys,
  type OrgLlmKeyProvider,
  type OrgLlmKeySource,
  type OrgLlmKeyStatus,
} from './org-llm-keys'
