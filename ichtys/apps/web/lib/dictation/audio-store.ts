import { createHash } from 'node:crypto'
import { and, clinicalEvolutions, db, dictationAudios, eq, isNotNull, lt } from '@ichtys/db'
import type { DbTransaction } from '../audit/audited-write'
import { decryptClinicalContent, encryptClinicalContent } from '../subjects/phi-fields'
import { DICTATION_AUDIO_MAX_BYTES, DICTATION_AUDIO_RETENTION_DAYS } from './protocol'

export { DICTATION_AUDIO_MAX_BYTES, DICTATION_AUDIO_RETENTION_DAYS }

/**
 * La grabación de una evolución dictada (docs/decisions/consulta-dictada.md, D14).
 * Decidido por Santiago el 12/11/2026: se guarda, en almacenamiento privado.
 */

/** Lo que graba un navegador o exporta un teléfono. Solo el tipo base, sin parámetros. */
export const DICTATION_AUDIO_MIMES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'video/mp4', 'video/webm'] as const

export function baseMime(contentType: string | null): string | null {
  const base = (contentType ?? '').split(';')[0]!.trim().toLowerCase()
  return (DICTATION_AUDIO_MIMES as readonly string[]).includes(base) ? base : null
}

export function retentionDeadline(from: Date): Date {
  return new Date(from.getTime() + DICTATION_AUDIO_RETENTION_DAYS * 24 * 60 * 60 * 1000)
}

export interface EvolutionRef {
  id: string
  authorUserId: string
}

/** La evolución, solo si es de esta organización, este estudio y este sujeto. */
export async function findEvolution(params: { orgId: string; studyId: string; subjectId: string; evolutionId: string }): Promise<EvolutionRef | null> {
  const [row] = await db
    .select({ id: clinicalEvolutions.id, authorUserId: clinicalEvolutions.authorUserId })
    .from(clinicalEvolutions)
    .where(
      and(
        eq(clinicalEvolutions.id, params.evolutionId),
        eq(clinicalEvolutions.organizationId, params.orgId),
        eq(clinicalEvolutions.studyId, params.studyId),
        eq(clinicalEvolutions.subjectId, params.subjectId),
      ),
    )
    .limit(1)
  return row ?? null
}

export interface StoredAudioMeta {
  id: string
  sha256: string
  sizeBytes: number
  expiresAt: Date
}

/** Guarda la grabación cifrada. Una por evolución: si ya hay una, no la pisa y devuelve null. */
export async function storeDictationAudio(
  tx: DbTransaction,
  params: {
    orgId: string
    studyId: string
    subjectId: string
    evolutionId: string
    actorId: string
    mime: string
    durationSec: number
    bytes: Uint8Array
    now: Date
  },
): Promise<StoredAudioMeta | null> {
  const sha256 = createHash('sha256').update(params.bytes).digest('hex')
  const expiresAt = retentionDeadline(params.now)
  const inserted = await tx
    .insert(dictationAudios)
    .values({
      organizationId: params.orgId,
      studyId: params.studyId,
      subjectId: params.subjectId,
      evolutionId: params.evolutionId,
      mime: params.mime,
      sizeBytes: params.bytes.byteLength,
      durationSec: params.durationSec,
      sha256,
      contentEncrypted: encryptClinicalContent(Buffer.from(params.bytes).toString('base64')),
      createdBy: params.actorId,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: dictationAudios.id })
  const row = inserted[0]
  return row ? { id: row.id, sha256, sizeBytes: params.bytes.byteLength, expiresAt } : null
}

export interface AudioListing {
  evolutionId: string
  durationSec: number
  expiresAt: Date
  /** `false`: venció y se borró; queda la constancia. */
  available: boolean
}

/** Qué evoluciones de un sujeto tienen grabación. Sin contenido. */
export async function listSubjectAudios(params: { orgId: string; studyId: string; subjectId: string; now: Date }): Promise<AudioListing[]> {
  const rows = await db
    .select({
      evolutionId: dictationAudios.evolutionId,
      durationSec: dictationAudios.durationSec,
      expiresAt: dictationAudios.expiresAt,
      purgedAt: dictationAudios.purgedAt,
    })
    .from(dictationAudios)
    .where(
      and(
        eq(dictationAudios.organizationId, params.orgId),
        eq(dictationAudios.studyId, params.studyId),
        eq(dictationAudios.subjectId, params.subjectId),
      ),
    )
  return rows.map((row) => ({
    evolutionId: row.evolutionId,
    durationSec: row.durationSec,
    expiresAt: row.expiresAt,
    available: row.purgedAt === null && row.expiresAt.getTime() > params.now.getTime(),
  }))
}

export type LoadedAudio = { state: 'ok'; id: string; mime: string; bytes: Uint8Array } | { state: 'missing' } | { state: 'expired' }

/** La grabación descifrada. Una vencida no se entrega aunque la limpieza todavía no haya pasado. */
export async function loadDictationAudio(params: { orgId: string; studyId: string; subjectId: string; evolutionId: string; now: Date }): Promise<LoadedAudio> {
  const [row] = await db
    .select({
      id: dictationAudios.id,
      mime: dictationAudios.mime,
      contentEncrypted: dictationAudios.contentEncrypted,
      expiresAt: dictationAudios.expiresAt,
    })
    .from(dictationAudios)
    .where(
      and(
        eq(dictationAudios.evolutionId, params.evolutionId),
        eq(dictationAudios.organizationId, params.orgId),
        eq(dictationAudios.studyId, params.studyId),
        eq(dictationAudios.subjectId, params.subjectId),
      ),
    )
    .limit(1)
  if (!row) return { state: 'missing' }
  if (row.contentEncrypted === null || row.expiresAt.getTime() <= params.now.getTime()) return { state: 'expired' }
  const bytes = new Uint8Array(Buffer.from(decryptClinicalContent(row.contentEncrypted), 'base64'))
  return { state: 'ok', id: row.id, mime: row.mime, bytes }
}

/** Borra el contenido de las grabaciones vencidas y deja la constancia. Devuelve cuáles, por organización. */
export async function purgeExpiredDictationAudios(tx: DbTransaction, now: Date): Promise<Array<{ id: string; organizationId: string; studyId: string }>> {
  return tx
    .update(dictationAudios)
    .set({ contentEncrypted: null, purgedAt: now })
    .where(and(lt(dictationAudios.expiresAt, now), isNotNull(dictationAudios.contentEncrypted)))
    .returning({ id: dictationAudios.id, organizationId: dictationAudios.organizationId, studyId: dictationAudios.studyId })
}
