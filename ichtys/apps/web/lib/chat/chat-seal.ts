import type { AuditLogParams } from './persistence'
import { PhiConfigError, decryptClinicalContent, encryptClinicalContent } from '../subjects/phi-fields'
import { checkKeyAgainstStored, type KeyCheck } from '../subjects/screening-seal'

/**
 * Sellado del chat (decisión del 16/11/2026): lo que se guardó en claro antes del cifrado
 * —cuerpo de los mensajes, título de las conversaciones— pasa a su columna cifrada y la
 * columna en claro queda vacía. Las anotaciones viejas se vacían: ya no se guardan.
 *
 * Sellar no cambia el contenido: es el mismo texto, guardado de otra forma. Cada texto se
 * cifra, se vuelve a abrir y se compara con el original antes de escribir nada.
 *
 * Acá está la decisión por fila y el recorrido, sin base; quien toca la base es el depósito
 * (`chat-seal-store.ts`). Ningún valor de retorno ni error lleva texto del chat.
 */
export type ChatSealKind = 'message' | 'title'

/** Lo sellado no vuelve igual al abrirlo. No lleva contenido: solo qué fila. */
export class ChatSealRoundTripError extends Error {
  constructor(
    readonly kind: ChatSealKind,
    readonly rowId: string,
  ) {
    super(`chat-seal: la fila ${rowId} (${kind}) no vuelve igual después de cifrar`)
    this.name = 'ChatSealRoundTripError'
  }
}

export type TextSealPlan =
  /** No hay nada en claro. */
  | { action: 'none' }
  /** Se cifra el texto en claro y se vacía la columna en claro. */
  | { action: 'seal'; encrypted: string }
  /** Ya hay una versión cifrada que se abre: gana esa, y solo se vacía la columna en claro. */
  | { action: 'clear_plain' }
  /** Hay una versión cifrada que no se abre con esta clave: no se toca nada y se informa. */
  | { action: 'blocked' }

/**
 * Qué hacer con un texto que puede estar en claro, cifrado o de las dos formas. Con las dos
 * formas gana la cifrada (es lo que lee la aplicación), pero el texto en claro solo se borra
 * si la cifrada se puede abrir: si no, borrar sería perder el único ejemplar legible.
 */
export function planTextSeal(
  kind: ChatSealKind,
  row: { id: string; plain: string | null; encrypted: string | null },
  encrypt: (text: string) => string = encryptClinicalContent,
  decrypt: (payload: string) => string = decryptClinicalContent,
): TextSealPlan {
  if (row.plain === null) return { action: 'none' }
  if (row.encrypted !== null) {
    try {
      decrypt(row.encrypted)
      return { action: 'clear_plain' }
    } catch (err) {
      if (err instanceof PhiConfigError) throw err
      return { action: 'blocked' }
    }
  }
  const encrypted = encrypt(row.plain)
  let opened: string
  try {
    opened = decrypt(encrypted)
  } catch (err) {
    if (err instanceof PhiConfigError) throw err
    throw new ChatSealRoundTripError(kind, row.id)
  }
  if (opened !== row.plain) throw new ChatSealRoundTripError(kind, row.id)
  return { action: 'seal', encrypted }
}

/** Lo que una tanda escribió en una organización: cantidades. */
export interface ChatSealBatchCount {
  messages: number
  titles: number
  /** Mensajes a los que se les vació la columna de anotaciones. */
  annotationsCleared: number
  /** Filas que se dejaron sin tocar porque su versión cifrada no se abre. */
  blocked: number
}

export const emptyBatch = (): ChatSealBatchCount => ({ messages: 0, titles: 0, annotationsCleared: 0, blocked: 0 })
export const batchWrote = (count: ChatSealBatchCount): number => count.messages + count.titles + count.annotationsCleared

/**
 * Registro de una tanda para una organización (R3): cantidades y quién responde, nunca
 * texto. `contentChanged: false` es lo que la ida y vuelta comprobó.
 */
export function chatSealAuditEntry(orgId: string, count: ChatSealBatchCount, operator: string): AuditLogParams {
  return {
    action: 'admin.action',
    orgId,
    userId: operator,
    resourceType: 'messages',
    metadata: {
      type: 'chat_encrypted_at_rest',
      messages: count.messages,
      titles: count.titles,
      annotationsCleared: count.annotationsCleared,
      columns: ['messages.content', 'conversations.title', 'messages.annotations'],
      contentChanged: false,
      automated: true,
      humanConfirmed: false,
      operator,
    },
  }
}

/** Una organización en el resumen del sistema: solo cantidades. */
export interface ChatSealOverviewRow {
  organizationId: string
  messages: number
  plainMessages: number
  plainTitles: number
  annotations: number
}

export const overviewPending = (org: ChatSealOverviewRow): number => org.plainMessages + org.plainTitles + org.annotations

/** Lo que el recorrido necesita de la base, siempre dentro de una organización. */
export interface ChatSealStore {
  /**
   * Una tanda en **una** transacción: toma hasta `limit` mensajes y hasta `limit`
   * conversaciones con algo para sellar, escribe y, si escribió algo, deja el registro que
   * arma `audit`. Si algo tira, no queda nada de la tanda.
   */
  sealBatch(limit: number, audit: (count: ChatSealBatchCount) => AuditLogParams): Promise<ChatSealBatchCount>
}

export type ChatSealOutcome =
  | {
      status: 'done' | 'partial'
      /** Organizaciones donde se escribió algo en este pedido. */
      organizations: number
      messages: number
      titles: number
      annotationsCleared: number
      batches: number
      /** Lo que queda en claro en todo el sistema después del pedido. */
      remainingMessages: number
      remainingTitles: number
      remainingAnnotations: number
      /** Filas salteadas porque su versión cifrada no se abre con esta clave. */
      blocked: number
    }
  | { status: 'no_key' | 'key_mismatch' | 'key_unverified' }

export interface ChatSealDeps {
  overview: () => Promise<ChatSealOverviewRow[]>
  /** Textos ya cifrados de la base, para comprobar que la clave de la aplicación es la suya. */
  keySamples: () => Promise<string[]>
  storeFor: (orgId: string) => ChatSealStore
}

export interface ChatSealOptions {
  userId: string
  batchSize: number
  /** Pasado este tiempo no se abre otra tanda: lo que falte queda para el pedido siguiente. */
  budgetMs: number
  now?: () => number
  checkKey?: (samples: readonly string[]) => KeyCheck
  /** Tira `PhiConfigError` si falta la clave. */
  probeKey?: () => void
}

/**
 * Sella el chat en todas las organizaciones, una por una, a nombre del operador. Se puede
 * repetir: lo ya sellado no se vuelve a elegir.
 *
 * La clave se comprueba antes de escribir contra algo que la base ya tiene cifrado: sellar
 * con otra clave dejaría todo el chat ilegible. Sin ninguna muestra contra qué comprobar,
 * no se sella (`key_unverified`).
 */
export async function runChatSeal(deps: ChatSealDeps, options: ChatSealOptions): Promise<ChatSealOutcome> {
  const now = options.now ?? Date.now
  const checkKey = options.checkKey ?? checkKeyAgainstStored
  const probeKey = options.probeKey ?? (() => void encryptClinicalContent('sonda'))
  const started = now()
  const pending = (await deps.overview()).filter((org) => overviewPending(org) > 0)

  const total = emptyBatch()
  let organizations = 0
  let batches = 0

  if (pending.length > 0) {
    try {
      probeKey()
    } catch (err) {
      if (err instanceof PhiConfigError) return { status: 'no_key' }
      throw err
    }
    const keyCheck = checkKey(await deps.keySamples())
    if (keyCheck === 'mismatch') return { status: 'key_mismatch' }
    if (keyCheck === 'no_sample') return { status: 'key_unverified' }

    for (const org of pending) {
      const store = deps.storeFor(org.organizationId)
      let wroteHere = false
      while (now() - started < options.budgetMs) {
        const count = await store.sealBatch(options.batchSize, (batch) => chatSealAuditEntry(org.organizationId, batch, options.userId))
        total.blocked += count.blocked
        if (batchWrote(count) === 0) break
        total.messages += count.messages
        total.titles += count.titles
        total.annotationsCleared += count.annotationsCleared
        batches += 1
        wroteHere = true
      }
      if (wroteHere) organizations += 1
      if (now() - started >= options.budgetMs) break
    }
  }

  const after = await deps.overview()
  const sum = (pick: (org: ChatSealOverviewRow) => number) => after.reduce((acc, org) => acc + pick(org), 0)
  const remainingMessages = sum((org) => org.plainMessages)
  const remainingTitles = sum((org) => org.plainTitles)
  const remainingAnnotations = sum((org) => org.annotations)
  return {
    status: remainingMessages + remainingTitles + remainingAnnotations === 0 ? 'done' : 'partial',
    organizations,
    messages: total.messages,
    titles: total.titles,
    annotationsCleared: total.annotationsCleared,
    batches,
    remainingMessages,
    remainingTitles,
    remainingAnnotations,
    blocked: total.blocked,
  }
}
