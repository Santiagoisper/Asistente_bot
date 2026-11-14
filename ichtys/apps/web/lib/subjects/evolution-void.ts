import type { EvolutionVoidReason, NewUnassignedDictationAudio } from '@ichtys/db'
import type { AuditLogParams } from '../chat/persistence'
import type { EvolutionRef } from './evolution-reader'

/**
 * Anular una evolución registrada en el sujeto equivocado y retirar sus grabaciones al depósito
 * de grabaciones sin sujeto (docs/decisions/grabacion-en-sujeto-equivocado.md, D24).
 *
 * - La evolución no se toca: se anula agregando una fila. Es definitivo (Santiago, 14/11/2026).
 * - Cada grabación pasa al depósito con su contenido, sus tramos, su fecha de grabación y su
 *   vencimiento **copiados**: pasar al depósito no puede ser una forma de guardarla más tiempo.
 * - La original queda vacía y con la fecha en que se retiró. No se borra nunca.
 * - O pasa todo, o no pasa nada: este servicio corre dentro de una transacción y, si un tramo
 *   no cierra, tira. Quien lo llama no atrapa ese error.
 *
 * El servicio no sabe de la base: habla con un `VoidStore`. El de verdad está en
 * `evolution-void-store.ts`. Quién puede anular lo decide la ruta, no este archivo.
 */

/** Una grabación tal como está guardada en el sujeto, antes de retirarla. */
export interface SourceAudio {
  id: string
  organizationId: string
  studyId: string
  evolutionId: string
  take: number
  mime: string
  sizeBytes: number
  durationSec: number
  sha256: string
  contentEncrypted: string | null
  segmentsEncrypted: string | null
  createdBy: string
  createdAt: Date
  expiresAt: Date
  purgedAt: Date | null
}

export interface VoidStore {
  /** La evolución dentro de su organización, estudio y sujeto, con su marca si ya está anulada. */
  findEvolution(): Promise<EvolutionRef | null>
  /** Guarda la anulación. `null`: ya había una (la fila es única por evolución). */
  insertVoid(row: { evolutionId: string; reason: EvolutionVoidReason; note: string | null; declaredBy: string; declaredAt: Date }): Promise<string | null>
  /** Las grabaciones de la evolución que todavía no se retiraron, en orden de toma. */
  audiosOf(): Promise<SourceAudio[]>
  insertDeposit(row: NewUnassignedDictationAudio): Promise<string>
  /** Vacía la original y le pone la fecha de retiro. `false`: no estaba, o ya estaba retirada. */
  withdrawAudio(id: string, at: Date): Promise<boolean>
  audit(entry: AuditLogParams): Promise<void>
}

export interface VoidEvolutionParams {
  orgId: string
  studyId: string
  subjectId: string
  evolutionId: string
  actorId: string
  reason: EvolutionVoidReason
  /** Nota corta de quien lo declara. Se guarda cifrada; no va al registro. */
  note?: string
  now: Date
}

export type VoidEvolutionResult =
  | { status: 'voided'; voidId: string; withdrawn: Array<{ sourceAudioId: string; depositId: string; take: number }> }
  | { status: 'not_found' }
  | { status: 'already_voided' }

/** `true`: la grabación ya venció aunque el borrado diario todavía no la haya vaciado. */
function overdue(audio: SourceAudio, now: Date): boolean {
  return audio.expiresAt.getTime() <= now.getTime()
}

/**
 * La fila del depósito: todo copiado de la original, sin sujeto. Una grabación que ya venció
 * pasa como constancia, sin contenido: si no, viviría en el depósito hasta el próximo borrado.
 */
export function depositRowFrom(audio: SourceAudio, declared: { by: string; at: Date }): NewUnassignedDictationAudio {
  const expired = overdue(audio, declared.at)
  return {
    organizationId: audio.organizationId,
    studyId: audio.studyId,
    sourceAudioId: audio.id,
    evolutionId: audio.evolutionId,
    take: audio.take,
    mime: audio.mime,
    sizeBytes: audio.sizeBytes,
    durationSec: audio.durationSec,
    sha256: audio.sha256,
    contentEncrypted: expired ? null : audio.contentEncrypted,
    segmentsEncrypted: expired ? null : audio.segmentsEncrypted,
    createdBy: audio.createdBy,
    // Copiados, no recalculados: el plazo no se reinicia.
    createdAt: audio.createdAt,
    expiresAt: audio.expiresAt,
    purgedAt: audio.purgedAt ?? (expired ? declared.at : null),
    declaredBy: declared.by,
    declaredAt: declared.at,
  }
}

export async function voidEvolution(store: VoidStore, params: VoidEvolutionParams): Promise<VoidEvolutionResult> {
  const evolution = await store.findEvolution()
  if (!evolution) return { status: 'not_found' }
  if (evolution.voided) return { status: 'already_voided' }

  const note = params.note?.trim() || null
  const voidId = await store.insertVoid({ evolutionId: params.evolutionId, reason: params.reason, note, declaredBy: params.actorId, declaredAt: params.now })
  // Otra persona la anuló entre la lectura y la escritura: la fila única decide.
  if (voidId === null) return { status: 'already_voided' }

  const base = { orgId: params.orgId, studyId: params.studyId, userId: params.actorId }
  const withdrawn: Array<{ sourceAudioId: string; depositId: string; take: number }> = []
  for (const audio of await store.audiosOf()) {
    // Primero la copia, después se vacía la original: en ningún momento el contenido deja de estar.
    const depositId = await store.insertDeposit(depositRowFrom(audio, { by: params.actorId, at: params.now }))
    if (!(await store.withdrawAudio(audio.id, params.now))) throw new Error('evolution_void_withdraw_failed')
    withdrawn.push({ sourceAudioId: audio.id, depositId, take: audio.take })
    await store.audit({
      ...base,
      action: 'evolution.audio.withdraw',
      resourceType: 'dictation_audio',
      resourceId: audio.id,
      metadata: {
        subjectId: params.subjectId,
        evolutionId: params.evolutionId,
        take: audio.take,
        depositId,
        reason: params.reason,
        // Ya había vencido: su contenido no pasó al depósito.
        ...(audio.contentEncrypted !== null && overdue(audio, params.now) ? { contentExpired: true } : {}),
      },
    })
  }

  // Sin el texto de la nota y sin el código del sujeto: solo que hubo nota.
  await store.audit({
    ...base,
    action: 'evolution.void',
    resourceType: 'clinical_evolution',
    resourceId: params.evolutionId,
    metadata: { subjectId: params.subjectId, reason: params.reason, audiosWithdrawn: withdrawn.length, hasNote: note !== null },
  })

  return { status: 'voided', voidId, withdrawn }
}
