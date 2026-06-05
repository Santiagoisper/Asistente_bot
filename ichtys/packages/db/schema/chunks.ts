import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  vector,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { studies } from './studies'
import { documents, documentVersions, documentType } from './documents'

/**
 * Dimensión del embedding. Alineado con text-embedding-3-small (OpenAI) = 1536.
 * Si se cambia el modelo, actualizar acá y regenerar embeddings.
 */
export const EMBEDDING_DIMENSIONS = 1536

/**
 * chunks — unidad de retrieval. Cada chunk lleva su embedding y la metadata
 * de seguridad (organization_id + study_id) que se filtra ANTES del vector search.
 */
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id),
    documentType: text('document_type', { enum: documentType }).notNull(),
    pageStart: integer('page_start').notNull(),
    pageEnd: integer('page_end').notNull(),
    sectionTitle: text('section_title'),
    content: text('content').notNull(),
    tokenCount: integer('token_count'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Filtro de tenant/study — se usa SIEMPRE antes del similarity search.
    orgStudyIdx: index('chunks_org_study_idx').on(t.organizationId, t.studyId),
    // Índice vectorial (IVFFlat, cosine). La migration crea la extensión vector.
    embeddingIdx: index('chunks_embedding_idx').using(
      'ivfflat',
      t.embedding.op('vector_cosine_ops'),
    ),
  }),
)

export const chunksRelations = relations(chunks, ({ one }) => ({
  document: one(documents, {
    fields: [chunks.documentId],
    references: [documents.id],
  }),
  documentVersion: one(documentVersions, {
    fields: [chunks.documentVersionId],
    references: [documentVersions.id],
  }),
}))

export type Chunk = typeof chunks.$inferSelect
export type NewChunk = typeof chunks.$inferInsert
