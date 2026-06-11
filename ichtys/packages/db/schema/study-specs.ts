import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { studies } from './studies'
import { documentVersions } from './documents'
import { studySpecStatus } from './enums'

/**
 * study_specs — especificación estructurada del estudio extraída del protocolo.
 *
 * Complementa (no reemplaza) los chunks: los chunks alimentan el RAG; el spec
 * es el objeto tipado (criterios, visitas, endpoints) que consumen las capas
 * operativas (checklists, ventanas de visita, elegibilidad).
 *
 * - El contenido vive en `spec` (jsonb) y se valida con Zod
 *   (packages/ingestion/study-spec.ts) en cada escritura. Cada item lleva
 *   provenance (sourcePages) y confidence — trazabilidad ALPHI.
 * - Versionado por estudio: `version` incrementa con cada extracción.
 *   El diff entre versiones es la base del análisis de enmiendas.
 * - Nace 'draft'; la aprobación humana lo pasa a 'approved' y marca la
 *   versión anterior como 'superseded'.
 */
export const studySpecs = pgTable(
  'study_specs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id),
    /** Versión del documento fuente (protocolo) de la que se extrajo. */
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id),
    version: integer('version').notNull(),
    status: text('status', { enum: studySpecStatus }).notNull().default('draft'),
    /** StudySpec serializado — validado con Zod antes de cada insert. */
    spec: jsonb('spec').notNull(),
    /** Modelo LLM usado en la extracción (trazabilidad regulatoria). */
    extractionModel: text('extraction_model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgStudyIdx: index('study_specs_org_study_idx').on(t.organizationId, t.studyId),
  }),
)

export const studySpecsRelations = relations(studySpecs, ({ one }) => ({
  organization: one(organizations, {
    fields: [studySpecs.organizationId],
    references: [organizations.id],
  }),
  study: one(studies, {
    fields: [studySpecs.studyId],
    references: [studies.id],
  }),
  documentVersion: one(documentVersions, {
    fields: [studySpecs.documentVersionId],
    references: [documentVersions.id],
  }),
}))

export type StudySpecRow = typeof studySpecs.$inferSelect
export type NewStudySpecRow = typeof studySpecs.$inferInsert
