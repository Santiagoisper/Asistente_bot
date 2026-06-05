import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { sites } from './sites'
import { documents } from './documents'
import { conversations } from './conversations'

/**
 * studies — unidad de aislamiento de documentos.
 * Todo retrieval y toda respuesta operan dentro de un único study.
 */
export const studyStatus = ['active', 'closed', 'archived'] as const
export type StudyStatus = (typeof studyStatus)[number]

export const studies = pgTable('studies', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  siteId: uuid('site_id').references(() => sites.id),
  name: text('name').notNull(),
  protocolNumber: text('protocol_number'),
  status: text('status', { enum: studyStatus }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const studiesRelations = relations(studies, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [studies.organizationId],
    references: [organizations.id],
  }),
  site: one(sites, {
    fields: [studies.siteId],
    references: [sites.id],
  }),
  documents: many(documents),
  conversations: many(conversations),
}))

export type Study = typeof studies.$inferSelect
export type NewStudy = typeof studies.$inferInsert
