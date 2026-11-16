import { pgTable, uuid, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { studies } from './studies'
import { subjects } from './subjects'

/**
 * screening_assessments — instantáneas de la evaluación determinista contra el protocolo extraído.
 * Es dato clínico: el motivo de cada criterio cita valores del sujeto y el resumen dice si cumple.
 * Por eso `assessments` y `summary` se guardan cifrados (un sobre `{ enc, ciphertext }` dentro del
 * mismo JSONB; ver apps/web/lib/subjects/screening-crypto.ts). No se puede contar ni filtrar por
 * su contenido en la base. Brecha C3 de docs/compliance/REGULATORY-BASELINE.md.
 */
export const screeningAssessments = pgTable(
  'screening_assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    studySpecVersion: integer('study_spec_version').notNull(),
    /** Timestamp del perfil usado en la evaluación. */
    profileUpdatedAt: timestamp('profile_updated_at', { withTimezone: true }).notNull(),
    assessments: jsonb('assessments').notNull(),
    summary: jsonb('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subjectCreatedIdx: index('screening_assessments_subject_created_idx').on(
      table.subjectId,
      table.createdAt,
    ),
    orgStudyIdx: index('screening_assessments_org_study_idx').on(
      table.organizationId,
      table.studyId,
    ),
  }),
)

export type ScreeningAssessmentRow = typeof screeningAssessments.$inferSelect
export type NewScreeningAssessmentRow = typeof screeningAssessments.$inferInsert

export const screeningAssessmentsRelations = relations(screeningAssessments, ({ one }) => ({
  organization: one(organizations, {
    fields: [screeningAssessments.organizationId],
    references: [organizations.id],
  }),
  study: one(studies, {
    fields: [screeningAssessments.studyId],
    references: [studies.id],
  }),
  subject: one(subjects, {
    fields: [screeningAssessments.subjectId],
    references: [subjects.id],
  }),
}))
