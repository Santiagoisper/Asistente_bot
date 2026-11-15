import { createHash } from 'node:crypto'
import type { ConnectorDescriptor, DeliveryRecord } from './connector'

/**
 * Contrato de entrega: qué se le manda a un sistema de destino, qué contesta, y un destino
 * simulado para ejercitar el circuito sin ningún sistema real detrás.
 *
 * Es una propuesta de contrato. Lo que pida el destino real (qué campos recibe, cómo confirma)
 * todavía no se conoce: cuando se conozca, se ajusta acá y las pruebas dicen qué cambió.
 *
 * Solo para el servidor: usa `node:crypto`. Desde un componente cliente se importa
 * `@ichtys/integrations/connector`.
 */

/** Saltos de línea unificados y Unicode en forma compuesta: el mismo texto, escrito igual. */
function canonicalText(text: string): string {
  return text.replace(/\r\n?/g, '\n').normalize('NFC')
}

/**
 * Forma canónica de lo que se entrega: claves ordenadas, sin espacios, sin claves sin valor, y
 * todo texto pasado por `canonicalText`. Las claves también se normalizan. Fija y escrita antes
 * de usarse: si cambia, las huellas ya guardadas dejan de coincidir.
 */
function canonicalize(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(canonicalText(value))
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item === undefined ? null : item)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [canonicalText(k), v] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Huella SHA-256 (hexadecimal) del contenido en forma canónica. Se calcula sobre el texto en claro. */
export function deliveryFingerprint(content: unknown): string {
  return createHash('sha256').update(canonicalize(content), 'utf8').digest('hex')
}

export type DeliverableKind = 'lab_report' | 'evolution'

export interface DeliveryEnvelope {
  /** Mismo registro y misma versión → misma clave. Entregar dos veces no registra dos veces. */
  idempotencyKey: string
  record: { kind: DeliverableKind; id: string; version: number }
  /** Huella del contenido exacto que una persona revisó. */
  contentFingerprint: string
  content: unknown
  /** Identificador de la cuenta que revisó. Nunca un nombre. */
  reviewedBy: string
  /** Hora del servidor, en UTC (ISO 8601). */
  reviewedAt: string
  /** Solo códigos: ni nombres ni documentos. */
  context: { studyCode: string; subjectCode: string; visitLabel?: string }
}

/** Arma el sobre. Sin una persona que haya revisado no hay nada que entregar. */
export function buildDeliveryEnvelope(input: {
  record: DeliveryEnvelope['record']
  content: unknown
  reviewedBy: string
  reviewedAt: Date
  context: DeliveryEnvelope['context']
}): DeliveryEnvelope {
  const reviewedBy = input.reviewedBy.trim()
  if (!reviewedBy) throw new Error('No se arma una entrega sin la persona que la revisó')
  return {
    idempotencyKey: `${input.record.kind}:${input.record.id}:v${input.record.version}`,
    record: input.record,
    contentFingerprint: deliveryFingerprint(input.content),
    content: input.content,
    reviewedBy,
    reviewedAt: input.reviewedAt.toISOString(),
    context: input.context,
  }
}

export type DeliveryFailureReason =
  /** El destino no respondió. Se puede reintentar. */
  | 'unreachable'
  /** La huella del sobre no corresponde a su contenido. */
  | 'fingerprint_mismatch'
  /** Ya hay una entrega con esa clave y otro contenido. */
  | 'conflict'

export type DeliverResult =
  | { ok: true; receiptId: string; duplicate: boolean }
  | { ok: false; reason: DeliveryFailureReason; retryable: boolean; detail: string }

export type DeliveryCheck = { found: false; registered: false } | { found: true; registered: boolean; contentFingerprint: string }

export interface DestinationConnector {
  descriptor: ConnectorDescriptor
  deliver(envelope: DeliveryEnvelope): Promise<DeliverResult>
  check(receiptId: string): Promise<DeliveryCheck>
}

/**
 * Qué se puede afirmar de una entrega. «Registrada» solo si el destino confirmó el registro **de
 * la misma huella** que se envió: si dice que registró otra cosa, queda en «enviada».
 */
export function toDeliveryRecord(
  connector: ConnectorDescriptor,
  result: DeliverResult,
  check?: DeliveryCheck,
  sentFingerprint?: string,
): DeliveryRecord {
  if (!result.ok) return { connectorId: connector.id, stage: 'failed', verified: false }
  const confirmed =
    check !== undefined && check.found && check.registered && sentFingerprint !== undefined && check.contentFingerprint === sentFingerprint
  return confirmed
    ? { connectorId: connector.id, stage: 'registered', verified: true }
    : { connectorId: connector.id, stage: 'sent', verified: false }
}

interface SimulatedEntry {
  receiptId: string
  idempotencyKey: string
  contentFingerprint: string
  registered: boolean
}

export interface SimulatedDestination extends DestinationConnector {
  /** La próxima entrega falla con este motivo. Para ensayar el reintento. */
  failNext(reason: 'unreachable'): void
  /** Marca como registrada una entrega recibida (cuando `registerOnDelivery` es falso). */
  confirm(receiptId: string): void
  /** Lo que el simulador tiene guardado. Sin contenido: solo claves y huellas. */
  inspect(): ReadonlyArray<Readonly<SimulatedEntry>>
}

/**
 * Destino simulado, en memoria. No hay ningún sistema real detrás y no guarda el contenido que
 * recibe: solo la clave y la huella. Se pierde al reiniciar el proceso.
 */
export function createSimulatedDestination(options: { registerOnDelivery?: boolean } = {}): SimulatedDestination {
  const registerOnDelivery = options.registerOnDelivery ?? true
  const entries = new Map<string, SimulatedEntry>()
  let pendingFailure: 'unreachable' | null = null

  return {
    descriptor: {
      id: 'historia-clinica-sim',
      label: 'Historia clínica',
      simulated: true,
      capabilities: ['deliver_proposal', 'check_delivery'],
    },

    async deliver(envelope) {
      if (pendingFailure) {
        pendingFailure = null
        return { ok: false, reason: 'unreachable', retryable: true, detail: 'El destino simulado no respondió.' }
      }
      if (deliveryFingerprint(envelope.content) !== envelope.contentFingerprint) {
        return { ok: false, reason: 'fingerprint_mismatch', retryable: false, detail: 'La huella no corresponde al contenido recibido.' }
      }
      const existing = entries.get(envelope.idempotencyKey)
      if (existing) {
        if (existing.contentFingerprint !== envelope.contentFingerprint) {
          return { ok: false, reason: 'conflict', retryable: false, detail: 'Ya hay una entrega de ese registro y esa versión con otro contenido.' }
        }
        return { ok: true, receiptId: existing.receiptId, duplicate: true }
      }
      const entry: SimulatedEntry = {
        receiptId: `sim-${entries.size + 1}`,
        idempotencyKey: envelope.idempotencyKey,
        contentFingerprint: envelope.contentFingerprint,
        registered: registerOnDelivery,
      }
      entries.set(envelope.idempotencyKey, entry)
      return { ok: true, receiptId: entry.receiptId, duplicate: false }
    },

    async check(receiptId) {
      const entry = [...entries.values()].find((candidate) => candidate.receiptId === receiptId)
      if (!entry) return { found: false, registered: false }
      return { found: true, registered: entry.registered, contentFingerprint: entry.contentFingerprint }
    },

    failNext(reason) {
      pendingFailure = reason
    },

    confirm(receiptId) {
      const entry = [...entries.values()].find((candidate) => candidate.receiptId === receiptId)
      if (entry) entry.registered = true
    },

    inspect() {
      return [...entries.values()].map((entry) => ({ ...entry }))
    },
  }
}
