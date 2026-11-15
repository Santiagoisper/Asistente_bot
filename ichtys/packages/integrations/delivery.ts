import { createHash } from 'node:crypto'
import { hasCapability, type ConnectorDescriptor, type DeliveryRecord } from './connector'

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

export type NonCanonicalReason =
  /** Algo que no es JSON plano: una fecha, un `Map`, un `Set`, una instancia de clase, bytes, un `bigint`, una función, un símbolo. */
  | 'unsupported_type'
  /** `NaN` o infinito: JSON los escribiría como `null`. */
  | 'non_finite_number'
  /** Ningún contenido, o un lugar sin valor dentro de un arreglo. */
  | 'missing_value'
  /** Dos claves del mismo objeto quedan iguales después de normalizar. */
  | 'duplicate_key'
  /** Un objeto que se contiene a sí mismo. */
  | 'circular_reference'

const NON_CANONICAL_MESSAGES: Record<NonCanonicalReason, string> = {
  unsupported_type: 'no es JSON plano',
  non_finite_number: 'es un número que JSON no puede escribir',
  missing_value: 'falta un valor',
  duplicate_key: 'dos claves quedan iguales después de normalizar',
  circular_reference: 'el contenido se contiene a sí mismo',
}

/**
 * El contenido no tiene forma canónica: no se calcula ninguna huella. Convertirlo en silencio
 * haría que dos contenidos distintos tuvieran la misma huella (una fecha pasada como `Date`
 * quedaría en `{}`, cualquiera sea la fecha).
 *
 * El mensaje dice qué se encontró y nunca repite el contenido ni sus claves: puede terminar en
 * un registro. Dónde está lo que frenó va aparte, en `path`.
 */
export class NonCanonicalContentError extends Error {
  readonly reason: NonCanonicalReason
  /** Qué se encontró: el tipo, nunca el valor (`Date`, `Map`, `bigint`, `NaN`…). */
  readonly found: string
  /** Dónde, desde la raíz: `$.filas[1].tomadaEl`. Lleva claves del contenido: no va al mensaje. */
  readonly path: string

  constructor(reason: NonCanonicalReason, found: string, path: string) {
    super(`El contenido no se puede entregar: ${NON_CANONICAL_MESSAGES[reason]} (${found}).`)
    this.name = 'NonCanonicalContentError'
    this.reason = reason
    this.found = found
    this.path = path
  }
}

/** Saltos de línea unificados y Unicode en forma compuesta: el mismo texto, escrito igual. */
function canonicalText(text: string): string {
  return text.replace(/\r\n?/g, '\n').normalize('NFC')
}

/** Cómo se llama lo que no es un objeto plano. El nombre de la clase es código, no contenido. */
function objectKind(value: object): string {
  const tag = Object.prototype.toString.call(value).slice(8, -1)
  if (tag !== 'Object') return tag
  const prototype: unknown = Object.getPrototypeOf(value)
  const constructorName =
    typeof prototype === 'object' && prototype !== null && 'constructor' in prototype && typeof prototype.constructor === 'function'
      ? prototype.constructor.name
      : ''
  return constructorName || 'Object'
}

/**
 * Forma canónica de lo que se entrega: claves ordenadas, sin espacios, sin claves sin valor, y
 * todo texto pasado por `canonicalText`. Las claves también se normalizan. Fija y escrita antes
 * de usarse: si cambia, las huellas ya guardadas dejan de coincidir.
 *
 * Solo JSON plano: texto, números finitos, booleanos, `null`, arreglos y objetos sin clase. Lo
 * demás frena con `NonCanonicalContentError`; nada se convierte en silencio. Las fechas las pasa
 * quien llama, ya como texto ISO 8601.
 */
function canonicalize(value: unknown, path: string, ancestors: readonly object[]): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(canonicalText(value))
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new NonCanonicalContentError('non_finite_number', String(value), path)
      return JSON.stringify(value)
    case 'undefined':
      throw new NonCanonicalContentError('missing_value', 'undefined', path)
    case 'bigint':
    case 'symbol':
    case 'function':
      throw new NonCanonicalContentError('unsupported_type', typeof value, path)
    case 'object':
      break
  }
  if (ancestors.includes(value)) throw new NonCanonicalContentError('circular_reference', objectKind(value), path)
  const inside = [...ancestors, value]

  if (Array.isArray(value)) {
    const items: string[] = []
    // Por índice y no con `map`: un hueco del arreglo también es un lugar sin valor.
    for (let index = 0; index < value.length; index += 1) items.push(canonicalize(value[index], `${path}[${index}]`, inside))
    return `[${items.join(',')}]`
  }

  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new NonCanonicalContentError('unsupported_type', objectKind(value), path)

  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]): readonly [string, unknown] => [canonicalText(k), v])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const parts: string[] = []
  let previous: string | undefined
  for (const [key, entryValue] of entries) {
    // Con la misma clave dos veces, la huella dependería del orden en que se escribieron.
    if (key === previous) throw new NonCanonicalContentError('duplicate_key', 'string', `${path}.${key}`)
    previous = key
    parts.push(`${JSON.stringify(key)}:${canonicalize(entryValue, `${path}.${key}`, inside)}`)
  }
  return `{${parts.join(',')}}`
}

/**
 * Versión de la forma canónica. Va delante de cada huella (`h1:…`): una huella guardada tiene que
 * decir cómo se calculó, o mañana nadie puede recalcularla. Si la forma canónica cambia, este
 * número sube y las huellas viejas se siguen pudiendo comprobar con la regla vieja.
 */
export const DELIVERY_FINGERPRINT_VERSION = 1

/**
 * Huella del contenido en forma canónica: `h<versión>:` y el SHA-256 en hexadecimal. Se calcula
 * sobre el texto en claro. Si el contenido no es JSON plano no hay huella: lanza
 * `NonCanonicalContentError`.
 */
export function deliveryFingerprint(content: unknown): string {
  const digest = createHash('sha256').update(canonicalize(content, '$', []), 'utf8').digest('hex')
  return `h${DELIVERY_FINGERPRINT_VERSION}:${digest}`
}

export type DeliverableKind = 'lab_report' | 'evolution'

export interface DeliveryEnvelope {
  /** Mismo origen, mismo registro y misma versión → misma clave. Entregar dos veces no registra dos veces. */
  idempotencyKey: string
  record: { kind: DeliverableKind; id: string; version: number }
  /** Huella del contenido exacto que una persona revisó. */
  contentFingerprint: string
  /**
   * El informe o la evolución, en JSON plano (las fechas, como texto ISO 8601). Es dato de salud
   * de una persona identificada por código: seudonimizado, no anónimo.
   */
  content: unknown
  /** Identificador de la cuenta que revisó. Nunca un nombre. */
  reviewedBy: string
  /** Hora del servidor, en UTC (ISO 8601). */
  reviewedAt: string
  /** Solo códigos: ni nombres ni documentos. */
  context: { studyCode: string; subjectCode: string; visitLabel?: string }
}

/**
 * Arma el sobre. Sin una persona que haya revisado no hay nada que entregar, y con un contenido
 * que no es JSON plano tampoco: `deliveryFingerprint` lanza `NonCanonicalContentError`.
 */
export function buildDeliveryEnvelope(input: {
  record: DeliveryEnvelope['record']
  content: unknown
  reviewedBy: string
  reviewedAt: Date
  context: DeliveryEnvelope['context']
  /**
   * De dónde sale la entrega. Entra en la clave de idempotencia para que dos organizaciones, o el
   * entorno de prueba y el de producción, no choquen si alguna vez comparten un destino.
   */
  origin: { organizationId: string; environment: string }
}): DeliveryEnvelope {
  const reviewedBy = input.reviewedBy.trim()
  if (!reviewedBy) throw new Error('No se arma una entrega sin la persona que la revisó')
  const organizationId = input.origin.organizationId.trim()
  const environment = input.origin.environment.trim()
  if (!organizationId || !environment || organizationId.includes('/') || environment.includes('/')) {
    throw new Error('No se arma una entrega sin su origen: organización y entorno, sin barras')
  }
  return {
    idempotencyKey: `${organizationId}/${environment}/${input.record.kind}:${input.record.id}:v${input.record.version}`,
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
  /** El contenido no es JSON plano: no tiene forma canónica y no se le puede calcular la huella. */
  | 'non_canonical_content'
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
 * Qué se puede afirmar de una entrega. «Registrada» solo si el conector declara que puede
 * comprobar (`check_delivery`) y el destino confirmó el registro **de la misma huella** que se
 * envió: si dice que registró otra cosa, o si el conector no sabe comprobar, queda en «enviada».
 */
export function toDeliveryRecord(
  connector: ConnectorDescriptor,
  result: DeliverResult,
  check?: DeliveryCheck,
  sentFingerprint?: string,
): DeliveryRecord {
  if (!result.ok) return { connectorId: connector.id, stage: 'failed', verified: false }
  const confirmed =
    hasCapability(connector, 'check_delivery') &&
    check !== undefined &&
    check.found &&
    check.registered &&
    sentFingerprint !== undefined &&
    check.contentFingerprint === sentFingerprint
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
      let receivedFingerprint: string
      try {
        receivedFingerprint = deliveryFingerprint(envelope.content)
      } catch (error) {
        if (!(error instanceof NonCanonicalContentError)) throw error
        return { ok: false, reason: 'non_canonical_content', retryable: false, detail: 'El contenido recibido no es JSON plano: no se le puede calcular la huella.' }
      }
      if (receivedFingerprint !== envelope.contentFingerprint) {
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
