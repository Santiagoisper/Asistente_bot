import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { clinicalEvolutions } from './clinical-evolutions'
import { dictationAudios } from './dictation-audios'
import { organizations } from './organizations'
import { studies } from './studies'

/**
 * unassigned_dictation_audios — grabaciones retiradas de un sujeto porque se dictaron en el
 * equivocado (docs/decisions/grabacion-en-sujeto-equivocado.md, D24).
 *
 * - **No tiene columna de sujeto**, a propósito: una grabación acá no es parte de la historia
 *   de nadie. Guarda de qué grabación y de qué evolución vino.
 * - Sigue siendo dato clínico (una voz identifica a una persona): mismo cifrado, mismo
 *   vencimiento y mismo registro de escuchas que cualquier otra grabación.
 * - `created_at` y `expires_at` **se copian** de la grabación original y no tienen valor por
 *   defecto: pasar al depósito no puede ser una forma de guardar un audio más tiempo.
 * - El contenido se copia acá y se vacía en la original, en la misma transacción.
 */
export const unassignedDictationAudios = pgTable(
  'unassigned_dictation_audios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    studyId: uuid('study_id')
      .notNull()
      .references(() => studies.id, { onDelete: 'cascade' }),
    sourceAudioId: uuid('source_audio_id')
      .notNull()
      .references(() => dictationAudios.id, { onDelete: 'cascade' }),
    evolutionId: uuid('evolution_id')
      .notNull()
      .references(() => clinicalEvolutions.id, { onDelete: 'cascade' }),
    take: integer('take').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationSec: integer('duration_sec').notNull(),
    sha256: text('sha256').notNull(),
    /** Null después del borrado por vencimiento. */
    contentEncrypted: text('content_encrypted'),
    /** Los tramos viajan con la grabación (docs/decisions/enlace-frase-audio.md). */
    segmentsEncrypted: text('segments_encrypted'),
    /** Quién la grabó. */
    createdBy: text('created_by').notNull(),
    /** Cuándo se grabó: copiado de la original. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    /** Copiado de la original. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    /** Quién declaró que estaba en el sujeto equivocado, y cuándo. */
    declaredBy: text('declared_by').notNull(),
    declaredAt: timestamp('declared_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceIdx: uniqueIndex('unassigned_dictation_audios_source_uniq').on(table.sourceAudioId),
    orgStudyIdx: index('unassigned_dictation_audios_org_study_idx').on(table.organizationId, table.studyId),
    orgAuthorIdx: index('unassigned_dictation_audios_org_author_idx').on(table.organizationId, table.createdBy),
    expiryIdx: index('unassigned_dictation_audios_expires_idx').on(table.expiresAt),
  }),
)

export type UnassignedDictationAudio = typeof unassignedDictationAudios.$inferSelect
export type NewUnassignedDictationAudio = typeof unassignedDictationAudios.$inferInsert
