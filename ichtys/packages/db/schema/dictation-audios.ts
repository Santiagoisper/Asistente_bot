import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { clinicalEvolutions } from './clinical-evolutions'
import { organizations } from './organizations'
import { studies } from './studies'
import { subjects } from './subjects'

/**
 * dictation_audios — la grabación de la que salió una evolución dictada
 * (docs/decisions/consulta-dictada.md, D14). Una por evolución.
 *
 * - Va cifrada con @ichtys/crypto, como todo dato clínico.
 * - Se conserva hasta `expires_at`. Al vencer se borra el contenido y la fila
 *   queda, con `purged_at`: «hubo una grabación, de tanto, cargada por tal, con
 *   esta huella, y se borró tal día» tiene que poder responderse.
 * - `sha256` es la huella del audio tal como llegó, antes de cifrar.
 */
export const dictationAudios = pgTable(
  'dictation_audios',
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
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationSec: integer('duration_sec').notNull(),
    sha256: text('sha256').notNull(),
    /** Null después del borrado por vencimiento. */
    contentEncrypted: text('content_encrypted'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
  },
  (table) => ({
    evolutionIdx: uniqueIndex('dictation_audios_evolution_uniq').on(table.evolutionId),
    orgSubjectIdx: index('dictation_audios_org_subject_idx').on(table.organizationId, table.subjectId),
    expiryIdx: index('dictation_audios_expires_idx').on(table.expiresAt),
  }),
)

export type DictationAudio = typeof dictationAudios.$inferSelect
export type NewDictationAudio = typeof dictationAudios.$inferInsert
