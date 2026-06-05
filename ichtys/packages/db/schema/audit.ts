import { pgTable, bigserial, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

/**
 * audit_logs — append-only. Toda acción sensible deja rastro, incluyendo
 * intentos fallidos de acceso (ver SECURITY.md y CLAUDE.md regla 5).
 *
 * No tiene FKs duras a otras tablas: debe sobrevivir borrados (cascade) para
 * preservar la trazabilidad histórica.
 */
export const auditAction = [
  'document.upload',
  'document.delete',
  'ingestion.start',
  'ingestion.complete',
  'ingestion.error',
  'chat.question',
  'chat.answer',
  'chat.insufficient_evidence',
  'citation.view',
  'document.view',
  'auth.login',
  'auth.access_denied',
  'admin.action',
] as const
export type AuditAction = (typeof auditAction)[number]

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    organizationId: uuid('organization_id'),
    studyId: uuid('study_id'),
    userId: text('user_id'),
    action: text('action', { enum: auditAction }).notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    metadata: jsonb('metadata'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('audit_logs_org_idx').on(t.organizationId, t.createdAt),
    studyIdx: index('audit_logs_study_idx').on(t.studyId, t.createdAt),
  }),
)

export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
