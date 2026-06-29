import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { studies } from './studies'
import { documents, documentVersions } from './documents'
import { ingestionJobStatus } from './enums'

/**
 * ingestion_jobs — cola persistida para ingestión masiva de protocolos.
 *
 * Cada fila representa un PDF encolado (bulk import). El worker procesa jobs
 * en serie, actualiza status y reintenta hasta maxAttempts. El estado sobrevive
 * reinicios de Lambda y permite polling confiable desde la UI.
 */
export const ingestionJobs = pgTable(
  'ingestion_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** Agrupa jobs de un mismo POST /api/studies/bulk-import. */
    batchId: uuid('batch_id').notNull(),
    userId: text('user_id').notNull(),
    fileName: text('file_name').notNull(),
    studyId: uuid('study_id').references(() => studies.id, { onDelete: 'set null' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    documentVersionId: uuid('document_version_id').references(() => documentVersions.id, {
      onDelete: 'set null',
    }),
    status: text('status', { enum: ingestionJobStatus }).notNull().default('pending'),
    errorMessage: text('error_message'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    orgBatchIdx: index('ingestion_jobs_org_batch_idx').on(t.organizationId, t.batchId),
    statusIdx: index('ingestion_jobs_status_idx').on(t.status),
  }),
)

export const ingestionJobsRelations = relations(ingestionJobs, ({ one }) => ({
  organization: one(organizations, {
    fields: [ingestionJobs.organizationId],
    references: [organizations.id],
  }),
  study: one(studies, {
    fields: [ingestionJobs.studyId],
    references: [studies.id],
  }),
  document: one(documents, {
    fields: [ingestionJobs.documentId],
    references: [documents.id],
  }),
  documentVersion: one(documentVersions, {
    fields: [ingestionJobs.documentVersionId],
    references: [documentVersions.id],
  }),
}))

export type IngestionJobRow = typeof ingestionJobs.$inferSelect
export type NewIngestionJobRow = typeof ingestionJobs.$inferInsert
