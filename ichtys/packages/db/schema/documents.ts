import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { studies } from './studies'
import { chunks } from './chunks'
import { documentType, documentVersionStatus } from './enums'

/**
 * documents — entidad lógica del documento dentro de un study.
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    documentType: text('document_type', { enum: documentType }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgStudyIdx: index('documents_org_study_idx').on(t.organizationId, t.studyId),
  }),
)

/**
 * document_versions — cada re-upload genera una nueva versión; se conserva historial.
 * El PDF vive en Vercel Blob; se sirve SIEMPRE con signed URL (ver SECURITY.md).
 */
export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id),
    blobUrl: text('blob_url').notNull(),
    blobKey: text('blob_key').notNull().unique(),
    pageCount: integer('page_count'),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
    status: text('status', { enum: documentVersionStatus }).notNull().default('pending'),
    errorMessage: text('error_message'),
    versionNumber: integer('version_number').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    documentIdx: index('document_versions_document_idx').on(t.documentId),
  }),
)

/**
 * pages — texto extraído página por página de una versión de documento.
 */
export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id),
    pageNumber: integer('page_number').notNull(),
    rawText: text('raw_text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionIdx: index('pages_version_idx').on(t.documentVersionId, t.pageNumber),
  }),
)

export const documentsRelations = relations(documents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [documents.organizationId],
    references: [organizations.id],
  }),
  study: one(studies, {
    fields: [documents.studyId],
    references: [studies.id],
  }),
  versions: many(documentVersions),
  chunks: many(chunks),
}))

export const documentVersionsRelations = relations(documentVersions, ({ one, many }) => ({
  document: one(documents, {
    fields: [documentVersions.documentId],
    references: [documents.id],
  }),
  pages: many(pages),
  chunks: many(chunks),
}))

export const pagesRelations = relations(pages, ({ one }) => ({
  documentVersion: one(documentVersions, {
    fields: [pages.documentVersionId],
    references: [documentVersions.id],
  }),
}))

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
export type DocumentVersion = typeof documentVersions.$inferSelect
export type NewDocumentVersion = typeof documentVersions.$inferInsert
export type Page = typeof pages.$inferSelect
export type NewPage = typeof pages.$inferInsert
