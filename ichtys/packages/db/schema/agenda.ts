import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { agendaItemKind, agendaItemStatus } from './enums'
import { organizations } from './organizations'
import { studies } from './studies'
import { subjects } from './subjects'

/**
 * agenda_items — turnos del sitio: visitas de un sujeto, extracciones,
 * llamados, monitoreos. `title` es el nombre operativo del turno ("Visita 3")
 * y no lleva datos del paciente; las notas libres van cifradas. El sujeto es
 * opcional porque un monitoreo no es de un sujeto.
 */
export const agendaItems = pgTable(
  'agenda_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    kind: text('kind', { enum: agendaItemKind }).notNull().default('visit'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    status: text('status', { enum: agendaItemStatus }).notNull().default('scheduled'),
    notesEncrypted: text('notes_encrypted'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgStartIdx: index('agenda_items_org_start_idx').on(table.organizationId, table.startsAt),
    subjectStartIdx: index('agenda_items_subject_start_idx').on(table.subjectId, table.startsAt),
  }),
)

export type AgendaItem = typeof agendaItems.$inferSelect
export type NewAgendaItem = typeof agendaItems.$inferInsert
