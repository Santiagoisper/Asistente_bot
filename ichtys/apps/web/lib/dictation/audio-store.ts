import { createHash } from 'node:crypto'
import { validateDictatedSegments, type DictatedSegment } from '@ichtys/clinical'
import { and, db, desc, dictationAudios, eq, inArray, isNotNull, isNull, lt, sql, unassignedDictationAudios } from '@ichtys/db'
import type { DbTransaction } from '../audit/audited-write'
import { decryptClinicalContent, encryptClinicalContent } from '../subjects/phi-fields'
import { audioState } from './audio-state'
import { DICTATION_AUDIO_MAX_BYTES, DICTATION_AUDIO_MAX_TAKES, DICTATION_AUDIO_RETENTION_DAYS } from './protocol'

export { DICTATION_AUDIO_MAX_BYTES, DICTATION_AUDIO_MAX_TAKES, DICTATION_AUDIO_RETENTION_DAYS }

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

export interface StoredAudioMeta {
  id: string
  sha256: string
  sizeBytes: number
  expiresAt: Date
}

/** Guarda la grabación cifrada de una toma. Una por toma (D22): si esa toma ya tiene una, no la pisa y devuelve null. */
export async function storeDictationAudio(
  tx: DbTransaction,
  params: {
    orgId: string
    studyId: string
    subjectId: string
    evolutionId: string
    /** Número de toma dentro de la evolución, desde 1. */
    take: number
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
      take: params.take,
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
  take: number
  durationSec: number
  expiresAt: Date
  /** `false`: venció y se borró, o se retiró; queda la constancia. */
  available: boolean
  /** Se retiró de este sujeto porque la evolución se registró en el equivocado (D24). No es una vencida. */
  withdrawn: boolean
  /** Tiene guardados los tramos de lo dictado y todavía se pueden leer (docs/decisions/enlace-frase-audio.md). */
  hasSegments: boolean
}

/** Las grabaciones de las evoluciones de un sujeto, una por toma. Sin contenido. */
export async function listSubjectAudios(params: { orgId: string; studyId: string; subjectId: string; now: Date }): Promise<AudioListing[]> {
  const rows = await db
    .select({
      evolutionId: dictationAudios.evolutionId,
      take: dictationAudios.take,
      durationSec: dictationAudios.durationSec,
      expiresAt: dictationAudios.expiresAt,
      purgedAt: dictationAudios.purgedAt,
      withdrawnAt: dictationAudios.withdrawnAt,
      contentEncrypted: dictationAudios.contentEncrypted,
      // Solo si hay o no: el texto de los tramos no se trae para listar.
      hasSegments: sql<boolean>`${dictationAudios.segmentsEncrypted} is not null`,
    })
    .from(dictationAudios)
    .where(
      and(
        eq(dictationAudios.organizationId, params.orgId),
        eq(dictationAudios.studyId, params.studyId),
        eq(dictationAudios.subjectId, params.subjectId),
      ),
    )
  return rows.map((row) => {
    const state = audioState({ hasContent: row.contentEncrypted !== null, expiresAt: row.expiresAt, purgedAt: row.purgedAt, withdrawnAt: row.withdrawnAt }, params.now)
    return {
      evolutionId: row.evolutionId,
      take: row.take,
      durationSec: row.durationSec,
      expiresAt: row.expiresAt,
      available: state === 'available',
      withdrawn: state === 'withdrawn',
      hasSegments: state === 'available' && row.hasSegments === true,
    }
  })
}

export type LoadedAudio = { state: 'ok'; id: string; mime: string; bytes: Uint8Array } | { state: 'missing' } | { state: 'expired' } | { state: 'withdrawn' }

/** La grabación descifrada de una toma. Una vencida no se entrega aunque la limpieza todavía no haya pasado. */
export async function loadDictationAudio(params: { orgId: string; studyId: string; subjectId: string; evolutionId: string; take: number; now: Date }): Promise<LoadedAudio> {
  const [row] = await db
    .select({
      id: dictationAudios.id,
      mime: dictationAudios.mime,
      contentEncrypted: dictationAudios.contentEncrypted,
      expiresAt: dictationAudios.expiresAt,
      purgedAt: dictationAudios.purgedAt,
      withdrawnAt: dictationAudios.withdrawnAt,
    })
    .from(dictationAudios)
    .where(
      and(
        eq(dictationAudios.evolutionId, params.evolutionId),
        eq(dictationAudios.take, params.take),
        eq(dictationAudios.organizationId, params.orgId),
        eq(dictationAudios.studyId, params.studyId),
        eq(dictationAudios.subjectId, params.subjectId),
      ),
    )
    .limit(1)
  if (!row) return { state: 'missing' }
  const state = audioState({ hasContent: row.contentEncrypted !== null, expiresAt: row.expiresAt, purgedAt: row.purgedAt, withdrawnAt: row.withdrawnAt }, params.now)
  if (state === 'withdrawn') return { state: 'withdrawn' }
  if (state === 'expired' || row.contentEncrypted === null) return { state: 'expired' }
  const bytes = new Uint8Array(Buffer.from(decryptClinicalContent(row.contentEncrypted), 'base64'))
  return { state: 'ok', id: row.id, mime: row.mime, bytes }
}

type AudioScope = { orgId: string; studyId: string; subjectId: string; evolutionId: string; take: number; now: Date }

async function readSegmentsRow(params: AudioScope) {
  const [row] = await db
    .select({
      id: dictationAudios.id,
      durationSec: dictationAudios.durationSec,
      createdBy: dictationAudios.createdBy,
      hasContent: sql<boolean>`${dictationAudios.contentEncrypted} is not null`,
      segmentsEncrypted: dictationAudios.segmentsEncrypted,
      expiresAt: dictationAudios.expiresAt,
      purgedAt: dictationAudios.purgedAt,
      withdrawnAt: dictationAudios.withdrawnAt,
    })
    .from(dictationAudios)
    .where(
      and(
        eq(dictationAudios.evolutionId, params.evolutionId),
        eq(dictationAudios.take, params.take),
        eq(dictationAudios.organizationId, params.orgId),
        eq(dictationAudios.studyId, params.studyId),
        eq(dictationAudios.subjectId, params.subjectId),
      ),
    )
    .limit(1)
  if (!row) return null
  const state = audioState({ hasContent: row.hasContent === true, expiresAt: row.expiresAt, purgedAt: row.purgedAt, withdrawnAt: row.withdrawnAt }, params.now)
  return { ...row, state }
}

export type SegmentsTarget =
  | { state: 'ok'; id: string; durationSec: number; createdBy: string; hasSegments: boolean }
  | { state: 'missing' }
  | { state: 'expired' }
  | { state: 'withdrawn' }

/** La grabación a la que se le van a guardar los tramos. Sin contenido ni texto. */
export async function findAudioForSegments(params: AudioScope): Promise<SegmentsTarget> {
  const row = await readSegmentsRow(params)
  if (!row) return { state: 'missing' }
  if (row.state === 'withdrawn') return { state: 'withdrawn' }
  if (row.state !== 'available') return { state: 'expired' }
  return { state: 'ok', id: row.id, durationSec: row.durationSec, createdBy: row.createdBy, hasSegments: row.segmentsEncrypted !== null }
}

/**
 * Guarda, cifrados, los tramos de una grabación (docs/decisions/enlace-frase-audio.md). Una sola
 * vez: si ya los tiene, o la grabación se borró o se retiró mientras tanto, no escribe y
 * devuelve `false`. Vencen con la grabación: el borrado vacía esta columna.
 */
export async function storeAudioSegments(tx: DbTransaction, params: { orgId: string; audioId: string; segments: readonly DictatedSegment[] }): Promise<boolean> {
  const updated = await tx
    .update(dictationAudios)
    .set({ segmentsEncrypted: encryptClinicalContent(JSON.stringify(params.segments)) })
    .where(
      and(
        eq(dictationAudios.id, params.audioId),
        eq(dictationAudios.organizationId, params.orgId),
        isNull(dictationAudios.segmentsEncrypted),
        isNotNull(dictationAudios.contentEncrypted),
        isNull(dictationAudios.withdrawnAt),
      ),
    )
    .returning({ id: dictationAudios.id })
  return updated.length > 0
}

export type LoadedSegments =
  | { state: 'ok'; id: string; segments: DictatedSegment[] }
  /** La grabación está, pero no tiene tramos (es anterior, o no se pudieron guardar). */
  | { state: 'none' }
  | { state: 'missing' }
  | { state: 'expired' }
  | { state: 'withdrawn' }

/** Los tramos descifrados de una toma. Los de una grabación vencida o retirada no se entregan. */
export async function loadAudioSegments(params: AudioScope): Promise<LoadedSegments> {
  const row = await readSegmentsRow(params)
  if (!row) return { state: 'missing' }
  if (row.state === 'withdrawn') return { state: 'withdrawn' }
  if (row.state !== 'available') return { state: 'expired' }
  if (row.segmentsEncrypted === null) return { state: 'none' }
  let parsed: unknown
  try {
    parsed = JSON.parse(decryptClinicalContent(row.segmentsEncrypted))
  } catch (error) {
    // Sin clave configurada es un problema del servidor, no «no hay tramos».
    if (error instanceof SyntaxError) return { state: 'none' }
    throw error
  }
  // Lo guardado se vuelve a comprobar: un tiempo que no cierra no llega al botón de escuchar.
  const segments = validateDictatedSegments(parsed, row.durationSec)
  return segments ? { state: 'ok', id: row.id, segments } : { state: 'none' }
}

/**
 * Borra el contenido de las grabaciones vencidas (y sus tramos) y deja la constancia. Devuelve
 * cuáles, por organización. Una retirada al depósito no es una vencida: se saltea, y su
 * contenido vence en el depósito con la misma fecha (D24).
 */
export async function purgeExpiredDictationAudios(tx: DbTransaction, now: Date): Promise<Array<{ id: string; organizationId: string; studyId: string }>> {
  return tx
    .update(dictationAudios)
    .set({ contentEncrypted: null, segmentsEncrypted: null, purgedAt: now })
    .where(and(lt(dictationAudios.expiresAt, now), isNotNull(dictationAudios.contentEncrypted), isNull(dictationAudios.withdrawnAt)))
    .returning({ id: dictationAudios.id, organizationId: dictationAudios.organizationId, studyId: dictationAudios.studyId })
}

/** Lo mismo para el depósito de grabaciones sin sujeto: mismo plazo, misma regla (D24). */
export async function purgeExpiredUnassignedAudios(tx: DbTransaction, now: Date): Promise<Array<{ id: string; organizationId: string; studyId: string }>> {
  return tx
    .update(unassignedDictationAudios)
    .set({ contentEncrypted: null, segmentsEncrypted: null, purgedAt: now })
    .where(and(lt(unassignedDictationAudios.expiresAt, now), isNotNull(unassignedDictationAudios.contentEncrypted)))
    .returning({ id: unassignedDictationAudios.id, organizationId: unassignedDictationAudios.organizationId, studyId: unassignedDictationAudios.studyId })
}

/** Una grabación sin sujeto, sin contenido (D24, punto 3). */
export interface UnassignedAudioMeta {
  id: string
  studyId: string
  evolutionId: string
  take: number
  mime: string
  durationSec: number
  /** Quién la grabó. */
  createdBy: string
  createdAt: Date
  expiresAt: Date
  purgedAt: Date | null
  /** Cuándo se retiró del sujeto. */
  declaredAt: Date
}

const UNASSIGNED_META = {
  id: unassignedDictationAudios.id,
  studyId: unassignedDictationAudios.studyId,
  evolutionId: unassignedDictationAudios.evolutionId,
  take: unassignedDictationAudios.take,
  mime: unassignedDictationAudios.mime,
  durationSec: unassignedDictationAudios.durationSec,
  createdBy: unassignedDictationAudios.createdBy,
  createdAt: unassignedDictationAudios.createdAt,
  expiresAt: unassignedDictationAudios.expiresAt,
  purgedAt: unassignedDictationAudios.purgedAt,
  declaredAt: unassignedDictationAudios.declaredAt,
}

/**
 * Tope de la lista: una persona no acumula tantas, y la respuesta no crece sin límite. Las
 * consultas piden una de más: así la ruta sabe si quedaron grabaciones afuera y lo dice.
 */
export const UNASSIGNED_AUDIO_LIST_MAX = 200

/*
 * La lista se arma en dos pasos, y el orden importa. Primero, en qué estudios hay grabaciones
 * sin sujeto (cada estudio una vez, sin tope); la ruta comprueba a cuáles entra la persona.
 * Después, las grabaciones **de esos estudios**, con el tope.
 *
 * El filtro por estudio va en la consulta, antes del tope. Cuando lo hacía la ruta, después,
 * las grabaciones de estudios a los que la persona no entra ocupaban el cupo: con 200 más
 * recientes en otro estudio, la lista salía vacía habiendo alguna (hallazgo de revisión del
 * #183). Por eso `studyIds` es obligatorio: no hay forma de pedir la lista sin decir de qué
 * estudios.
 */

/** Los estudios de esta organización en los que esta persona grabó algo que quedó sin sujeto. Cada uno una vez. */
export async function listUnassignedAudioStudiesByAuthor(params: { orgId: string; userId: string }): Promise<string[]> {
  const rows = await db
    .selectDistinct({ studyId: unassignedDictationAudios.studyId })
    .from(unassignedDictationAudios)
    .where(and(eq(unassignedDictationAudios.organizationId, params.orgId), eq(unassignedDictationAudios.createdBy, params.userId)))
  return rows.map((row) => row.studyId)
}

/** Los estudios de esta organización con alguna grabación sin sujeto. Cada uno una vez. Para quien coordina. */
export async function listUnassignedAudioStudiesOfOrg(params: { orgId: string }): Promise<string[]> {
  const rows = await db
    .selectDistinct({ studyId: unassignedDictationAudios.studyId })
    .from(unassignedDictationAudios)
    .where(eq(unassignedDictationAudios.organizationId, params.orgId))
  return rows.map((row) => row.studyId)
}

/**
 * Las grabaciones sin sujeto que grabó esta persona en esta organización, de los estudios que
 * se pasan, las más recientes primero. Sin contenido.
 */
export async function listUnassignedAudiosByAuthor(params: { orgId: string; userId: string; studyIds: string[] }): Promise<UnassignedAudioMeta[]> {
  if (params.studyIds.length === 0) return []
  return db
    .select(UNASSIGNED_META)
    .from(unassignedDictationAudios)
    .where(
      and(
        eq(unassignedDictationAudios.organizationId, params.orgId),
        eq(unassignedDictationAudios.createdBy, params.userId),
        inArray(unassignedDictationAudios.studyId, params.studyIds),
      ),
    )
    .orderBy(desc(unassignedDictationAudios.declaredAt))
    .limit(UNASSIGNED_AUDIO_LIST_MAX + 1)
}

/**
 * Las grabaciones sin sujeto de la organización, de los estudios que se pasan, las más
 * recientes primero. Sin contenido. Para quien coordina; a qué estudios entra lo comprueba la
 * ruta antes de pedirlas.
 */
export async function listUnassignedAudiosOfOrg(params: { orgId: string; studyIds: string[] }): Promise<UnassignedAudioMeta[]> {
  if (params.studyIds.length === 0) return []
  return db
    .select(UNASSIGNED_META)
    .from(unassignedDictationAudios)
    .where(and(eq(unassignedDictationAudios.organizationId, params.orgId), inArray(unassignedDictationAudios.studyId, params.studyIds)))
    .orderBy(desc(unassignedDictationAudios.declaredAt))
    .limit(UNASSIGNED_AUDIO_LIST_MAX + 1)
}

/** Una grabación sin sujeto de esta organización, sin contenido. Quién puede escucharla lo decide la ruta. */
export async function findUnassignedAudio(params: { orgId: string; id: string }): Promise<UnassignedAudioMeta | null> {
  const [row] = await db
    .select(UNASSIGNED_META)
    .from(unassignedDictationAudios)
    .where(and(eq(unassignedDictationAudios.id, params.id), eq(unassignedDictationAudios.organizationId, params.orgId)))
    .limit(1)
  return row ?? null
}

/** El contenido descifrado, o `null` si ya se borró. Se llama después de decidir que se entrega. */
export async function loadUnassignedAudioBytes(params: { orgId: string; id: string }): Promise<Uint8Array | null> {
  const [row] = await db
    .select({ contentEncrypted: unassignedDictationAudios.contentEncrypted })
    .from(unassignedDictationAudios)
    .where(and(eq(unassignedDictationAudios.id, params.id), eq(unassignedDictationAudios.organizationId, params.orgId)))
    .limit(1)
  if (!row || row.contentEncrypted === null) return null
  return new Uint8Array(Buffer.from(decryptClinicalContent(row.contentEncrypted), 'base64'))
}
