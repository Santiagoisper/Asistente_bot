import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { studies } from './studies'
import { subjects } from './subjects'

/**
 * patient_profiles — perfil estructurado extraído del sujeto (Fase 1 shell).
 * profile_encrypted: JSON cifrado; inicia como {} hasta Fase 2 NLP.
 */
export const patientProfiles = pgTable(
  'patient_profiles',
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
    profileEncrypted: text('profile_encrypted').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subjectUniqueIdx: uniqueIndex('patient_profiles_subject_idx').on(table.subjectId),
  }),
)

export type PatientProfile = typeof patientProfiles.$inferSelect
export type NewPatientProfile = typeof patientProfiles.$inferInsert

export const patientProfilesRelations = relations(patientProfiles, ({ one }) => ({
  organization: one(organizations, {
    fields: [patientProfiles.organizationId],
    references: [organizations.id],
  }),
  study: one(studies, {
    fields: [patientProfiles.studyId],
    references: [studies.id],
  }),
  subject: one(subjects, {
    fields: [patientProfiles.subjectId],
    references: [subjects.id],
  }),
}))
