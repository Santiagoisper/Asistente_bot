import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { studies } from './studies'
import { subjectStatus } from './enums'

/**
 * subjects — sujeto pseudonimizado del ensayo (Fase 1).
 * Sin PII directa: solo subject_code operacional (ej. GZBO-001).
 */
export const subjects = pgTable(
  'subjects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id, { onDelete: 'cascade' }),
    subjectCode: text('subject_code').notNull(),
    status: text('status', { enum: subjectStatus }).notNull().default('screening'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgStudyCodeIdx: uniqueIndex('subjects_org_study_code_idx').on(
      table.organizationId,
      table.studyId,
      table.subjectCode,
    ),
  }),
)

export type Subject = typeof subjects.$inferSelect
export type NewSubject = typeof subjects.$inferInsert

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [subjects.organizationId],
    references: [organizations.id],
  }),
  study: one(studies, {
    fields: [subjects.studyId],
    references: [studies.id],
  }),
  clinicalEvolutions: many(clinicalEvolutions),
  patientProfile: one(patientProfiles),
}))

import { clinicalEvolutions } from './clinical-evolutions'
import { patientProfiles } from './patient-profiles'
