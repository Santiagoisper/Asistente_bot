import { pgTable, uuid, text, timestamp, jsonb, bigint } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { sites } from './sites'
import { studies } from './studies'

/**
 * RAG config per organization.
 * Allows tuning similarity threshold and topK per org without a redeploy.
 * Nullable — falls back to system defaults (MIN_SIMILARITY_THRESHOLD, DEFAULT_TOP_K).
 */
export interface OrgRagConfig {
  /** Minimum cosine similarity to consider a chunk as evidence. Default: 0.15 */
  similarityThreshold?: number
  /** Max chunks to retrieve. Default: 20. Hard cap: 20. */
  topK?: number
  /**
   * Proveedor LLM para chat y extracción de specs.
   * `auto` = Claude → OpenAI → Groq → GLM (salta sin API key).
   */
  llmProvider?: 'anthropic' | 'openai' | 'google' | 'groq' | 'glm' | 'auto'
}

/**
 * organizations — tenant raíz.
 * Cada org se mapea 1:1 con una Clerk Organization (`clerk_org_id`).
 * El `organization_id` que viaja en queries SIEMPRE deriva del token de Clerk.
 */
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  clerkOrgId: text('clerk_org_id').notNull().unique(),
  /**
   * Per-org RAG tuning. Nullable — system defaults apply when absent.
   * Schema: { similarityThreshold?: number, topK?: number }
   */
  ragConfig: jsonb('rag_config').$type<OrgRagConfig>(),
  /** API keys LLM por org (AES-256-GCM, JSON cifrado). Solo org_admin. */
  llmApiKeysEncrypted: text('llm_api_keys_encrypted'),
  /** Nombre comercial del plan contratado (informativo). Null = sin plan asignado. */
  planName: text('plan_name'),
  /**
   * Cupo mensual de tokens de la plataforma (input+output) incluido en el plan.
   * Null = sin cupo definido (no se limita). Solo cuenta consumo con clave de la plataforma;
   * lo que se gasta con una clave propia de la organización no descuenta del cupo.
   */
  monthlyTokenQuota: bigint('monthly_token_quota', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const organizationsRelations = relations(organizations, ({ many }) => ({
  sites: many(sites),
  studies: many(studies),
}))

export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
