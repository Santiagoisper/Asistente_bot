import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { sites } from './sites'
import { documents } from './documents'
import { conversations } from './conversations'
import { subjects } from './subjects'
import { studyStatus } from './enums'

/**
 * studies — unidad de aislamiento de documentos.
 * Todo retrieval y toda respuesta operan dentro de un único study.
 */
export const studies = pgTable(
  'studies',
  {
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
  },
  (table) => ({
    // Redundante con la clave primaria. Existe para que una clave foránea
    // compuesta pueda exigir «este estudio, de esta organización»
    // (study_memberships): impide por construcción una membresía cruzada.
    idOrgUniqueIdx: uniqueIndex('studies_id_org_uniq').on(table.id, table.organizationId),
  }),
)

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
  subjects: many(subjects),
}))

export type Study = typeof studies.$inferSelect
export type NewStudy = typeof studies.$inferInsert
