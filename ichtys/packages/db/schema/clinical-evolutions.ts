import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { studies } from './studies'
import { subjects } from './subjects'

/**
 * clinical_evolutions — nota clínica por sujeto (Fase 1).
 * content_encrypted: texto libre cifrado con @ichtys/crypto (AES-256-GCM).
 */
export const clinicalEvolutions = pgTable(
  'clinical_evolutions',
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
    authorUserId: text('author_user_id').notNull(),
    visitLabel: text('visit_label'),
    contentEncrypted: text('content_encrypted').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subjectCreatedIdx: index('clinical_evolutions_subject_created_idx').on(
      table.subjectId,
      table.createdAt,
    ),
  }),
)

export type ClinicalEvolution = typeof clinicalEvolutions.$inferSelect
export type NewClinicalEvolution = typeof clinicalEvolutions.$inferInsert

export const clinicalEvolutionsRelations = relations(clinicalEvolutions, ({ one }) => ({
  organization: one(organizations, {
    fields: [clinicalEvolutions.organizationId],
    references: [organizations.id],
  }),
  study: one(studies, {
    fields: [clinicalEvolutions.studyId],
    references: [studies.id],
  }),
  subject: one(subjects, {
    fields: [clinicalEvolutions.subjectId],
    references: [subjects.id],
  }),
}))
