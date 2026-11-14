import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { clinicalEvolutions } from './clinical-evolutions'
import { organizations } from './organizations'
import { studies } from './studies'
import { subjects } from './subjects'

/** Por qué se anula una evolución. Lista cerrada: se amplía en el código, con su decisión. */
export const evolutionVoidReasons = ['wrong_subject'] as const
export type EvolutionVoidReason = (typeof evolutionVoidReasons)[number]

/**
 * evolution_voids — evoluciones anuladas (docs/decisions/grabacion-en-sujeto-equivocado.md, D24).
 *
 * La evolución no se modifica ni se borra: que está anulada se sabe porque existe una fila
 * acá. Una corrección no puede tapar lo que estaba escrito, y tiene que decir quién la hizo,
 * cuándo y por qué. Una fila por evolución: no se anula dos veces ni se desanula.
 */
export const evolutionVoids = pgTable(
  'evolution_voids',
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
    evolutionId: uuid('evolution_id')
      .notNull()
      .references(() => clinicalEvolutions.id, { onDelete: 'cascade' }),
    /** Uno de `evolutionVoidReasons`. */
    reason: text('reason').$type<EvolutionVoidReason>().notNull(),
    /** Nota corta de quien lo declara, cifrada. Opcional. */
    noteEncrypted: text('note_encrypted'),
    declaredBy: text('declared_by').notNull(),
    declaredAt: timestamp('declared_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    evolutionIdx: uniqueIndex('evolution_voids_evolution_uniq').on(table.evolutionId),
    orgSubjectIdx: index('evolution_voids_org_subject_idx').on(table.organizationId, table.subjectId),
  }),
)

export type EvolutionVoid = typeof evolutionVoids.$inferSelect
export type NewEvolutionVoid = typeof evolutionVoids.$inferInsert
