import { pgTable, uuid, text, timestamp, index, integer, check } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
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
    /**
     * Cuántas tomas tuvo el dictado del que salió esta evolución (D22). Vacío si no se dictó o
     * si se guardó antes de que existiera la columna. Se escribe una sola vez, al crearla: con
     * esto la pantalla puede decir de qué tomas no quedó grabación, incluida la última.
     */
    dictationTakes: integer('dictation_takes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subjectCreatedIdx: index('clinical_evolutions_subject_created_idx').on(
      table.subjectId,
      table.createdAt,
    ),
    dictationTakesCheck: check('clinical_evolutions_dictation_takes_check', sql`${table.dictationTakes} IS NULL OR ${table.dictationTakes} >= 1`),
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
