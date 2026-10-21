import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core'
import { usageKeySource, usageKind } from './enums'

/**
 * usage_events — un registro por llamada a un modelo (LLM o embeddings).
 *
 * Append-only y solo conteos: NO contiene prompts, respuestas ni texto de documentos
 * (puede haber PHI). Como audit_logs, no tiene FKs duras para sobrevivir borrados y
 * conservar el historial de facturación.
 *
 * El cupo mensual de un plan se mide sumando input+output de los eventos con
 * key_source = 'platform' del mes calendario UTC en curso.
 */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    studyId: uuid('study_id'),
    userId: text('user_id'),
    kind: text('kind', { enum: usageKind }).notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    keySource: text('key_source', { enum: usageKeySource }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgCreatedIdx: index('usage_events_org_created_idx').on(t.organizationId, t.createdAt.desc()),
  }),
)

export type UsageEvent = typeof usageEvents.$inferSelect
export type NewUsageEvent = typeof usageEvents.$inferInsert
