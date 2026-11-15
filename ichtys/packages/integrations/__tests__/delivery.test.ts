import { describe, expect, it } from 'vitest'
import { describeDelivery } from '../connector'
import {
  buildDeliveryEnvelope,
  createSimulatedDestination,
  deliveryFingerprint,
  NonCanonicalContentError,
  toDeliveryRecord,
  type DeliveryEnvelope,
} from '../delivery'

/** Todo lo que sigue es inventado: no hay ningún sistema real ni ningún paciente detrás. */
const CONTENT = { analito: 'HbA1c', valor: 7.4, unidad: '%', nota: 'Ayunas de 8 h.\nSin incidencias.' }
const input = (over: Partial<Parameters<typeof buildDeliveryEnvelope>[0]> = {}) => ({
  record: { kind: 'lab_report' as const, id: 'rec-1', version: 3 },
  content: CONTENT,
  reviewedBy: 'user_ficticio',
  reviewedAt: new Date('2026-11-15T18:00:00.000Z'),
  context: { studyCode: 'E2E-FICT-001', subjectCode: 'E2E-001' },
  ...over,
})
const envelope = (over = {}): DeliveryEnvelope => buildDeliveryEnvelope(input(over))

describe('huella de lo que se entrega', () => {
  it('el mismo contenido da la misma huella: otro orden de claves, otros saltos de línea, otra forma Unicode', () => {
    const base = deliveryFingerprint(CONTENT)
    expect(deliveryFingerprint({ unidad: '%', nota: CONTENT.nota, valor: 7.4, analito: 'HbA1c' })).toBe(base)
    expect(deliveryFingerprint({ ...CONTENT, nota: 'Ayunas de 8 h.\r\nSin incidencias.' })).toBe(base)
    const composed = deliveryFingerprint({ texto: 'evolución' })
    expect(deliveryFingerprint({ texto: 'evolución' })).toBe(composed)
    expect(base).toMatch(/^[0-9a-f]{64}$/)
  })

  it('un carácter distinto da otra huella', () => {
    expect(deliveryFingerprint({ ...CONTENT, valor: 7.5 })).not.toBe(deliveryFingerprint(CONTENT))
    expect(deliveryFingerprint({ ...CONTENT, nota: `${CONTENT.nota} ` })).not.toBe(deliveryFingerprint(CONTENT))
  })

  it('una clave sin valor no cuenta, pero un valor nulo sí', () => {
    expect(deliveryFingerprint({ ...CONTENT, extra: undefined })).toBe(deliveryFingerprint(CONTENT))
    expect(deliveryFingerprint({ ...CONTENT, extra: null })).not.toBe(deliveryFingerprint(CONTENT))
  })
})

/** Qué frenó la forma canónica: el motivo, qué encontró y dónde. Nunca el valor. */
function refusal(content: unknown): { reason: string; found: string; path: string } | 'no frenó' {
  try {
    deliveryFingerprint(content)
  } catch (error) {
    if (error instanceof NonCanonicalContentError) return { reason: error.reason, found: error.found, path: error.path }
    throw error
  }
  return 'no frenó'
}

describe('la forma canónica solo acepta JSON plano: lo demás frena, no se convierte', () => {
  class Muestra {
    constructor(readonly valor: number) {}
  }
  const holes: unknown[] = []
  holes.length = 2
  const circular: Record<string, unknown> = { nombre: 'a' }
  circular.yo = circular

  it.each([
    ['una fecha', { tomadaEl: new Date('2026-01-01T00:00:00.000Z') }, { reason: 'unsupported_type', found: 'Date', path: '$.tomadaEl' }],
    ['un Map', { m: new Map([['a', 1]]) }, { reason: 'unsupported_type', found: 'Map', path: '$.m' }],
    ['un Set', { s: new Set([1]) }, { reason: 'unsupported_type', found: 'Set', path: '$.s' }],
    ['una instancia de clase', { muestra: new Muestra(7.4) }, { reason: 'unsupported_type', found: 'Muestra', path: '$.muestra' }],
    ['bytes', { bytes: new Uint8Array([1, 2]) }, { reason: 'unsupported_type', found: 'Uint8Array', path: '$.bytes' }],
    ['NaN', { valor: Number.NaN }, { reason: 'non_finite_number', found: 'NaN', path: '$.valor' }],
    ['infinito', { valor: Number.POSITIVE_INFINITY }, { reason: 'non_finite_number', found: 'Infinity', path: '$.valor' }],
    ['menos infinito', { valor: Number.NEGATIVE_INFINITY }, { reason: 'non_finite_number', found: '-Infinity', path: '$.valor' }],
    ['un bigint', { valor: 10n }, { reason: 'unsupported_type', found: 'bigint', path: '$.valor' }],
    ['una función', { f: () => 1 }, { reason: 'unsupported_type', found: 'function', path: '$.f' }],
    ['un símbolo', { s: Symbol('x') }, { reason: 'unsupported_type', found: 'symbol', path: '$.s' }],
    ['un lugar sin valor en un arreglo', { filas: [1, undefined, 3] }, { reason: 'missing_value', found: 'undefined', path: '$.filas[1]' }],
    ['un arreglo con huecos', { filas: holes }, { reason: 'missing_value', found: 'undefined', path: '$.filas[0]' }],
    ['ningún contenido', undefined, { reason: 'missing_value', found: 'undefined', path: '$' }],
    ['algo anidado', { filas: [{ ok: 1 }, { tomadaEl: new Date(0) }] }, { reason: 'unsupported_type', found: 'Date', path: '$.filas[1].tomadaEl' }],
    ['una referencia a sí mismo', circular, { reason: 'circular_reference', found: 'Object', path: '$.yo' }],
  ])('%s frena con su motivo', (_name, content, expected) => {
    expect(refusal(content)).toEqual(expected)
  })

  it('dos claves que quedan iguales después de normalizar frenan, en cualquier orden', () => {
    const expected = { reason: 'duplicate_key', found: 'string', path: '$.\u00e9' }
    expect(refusal({ '\u00e9': 1, 'e\u0301': 2 })).toEqual(expected)
    expect(refusal({ 'e\u0301': 2, '\u00e9': 1 })).toEqual(expected)
  })

  it('el mensaje del error no repite el contenido ni sus claves', () => {
    try {
      deliveryFingerprint({ 'clave-reservada': { 'otra-clave': new Date('2026-01-01T00:00:00.000Z') } })
      throw new Error('tenía que frenar')
    } catch (error) {
      if (!(error instanceof NonCanonicalContentError)) throw error
      expect(error.message).not.toMatch(/clave-reservada|otra-clave|2026/)
      expect(error.message).toContain('Date')
    }
  })

  it('las mismas fechas, pasadas como texto, dan huellas distintas', () => {
    const a = deliveryFingerprint({ tomadaEl: new Date('2026-01-01T00:00:00.000Z').toISOString() })
    const b = deliveryFingerprint({ tomadaEl: new Date('2030-12-31T00:00:00.000Z').toISOString() })
    expect(a).not.toBe(b)
  })

  it('lo que es JSON plano sigue entrando: nulos, booleanos, ceros, arreglos y objetos sin prototipo', () => {
    const bare: Record<string, unknown> = Object.create(null)
    bare.a = 1
    expect(deliveryFingerprint(bare)).toBe(deliveryFingerprint({ a: 1 }))
    expect(deliveryFingerprint({ v: -0 })).toBe(deliveryFingerprint({ v: 0 }))
    expect(refusal({ n: null, s: '', b: false, cero: 0, filas: [[], {}, [null]] })).toBe('no frenó')
    const compartido = { a: 1 }
    expect(refusal({ uno: compartido, dos: compartido })).toBe('no frenó')
    expect(deliveryFingerprint(null)).not.toBe(deliveryFingerprint({}))
  })
})

describe('sobre de entrega', () => {
  it('con un contenido que no es JSON plano no hay sobre', () => {
    expect(() => envelope({ content: { tomadaEl: new Date('2026-01-01T00:00:00.000Z') } })).toThrow(NonCanonicalContentError)
  })

  it('lleva la huella del contenido, quién revisó y cuándo, y una clave que identifica registro y versión', () => {
    const built = envelope()
    expect(built.contentFingerprint).toBe(deliveryFingerprint(CONTENT))
    expect(built.idempotencyKey).toBe('lab_report:rec-1:v3')
    expect(built.reviewedBy).toBe('user_ficticio')
    expect(built.reviewedAt).toBe('2026-11-15T18:00:00.000Z')
  })

  it('otra versión del mismo registro es otra entrega', () => {
    expect(envelope({ record: { kind: 'lab_report', id: 'rec-1', version: 4 } }).idempotencyKey).toBe('lab_report:rec-1:v4')
  })

  it('sin una persona que lo haya revisado no hay sobre', () => {
    expect(() => envelope({ reviewedBy: '' })).toThrow(/revis/)
    expect(() => envelope({ reviewedBy: '   ' })).toThrow(/revis/)
  })
})

describe('destino simulado', () => {
  it('se declara simulador y así se nombra en todo lo que se muestra', async () => {
    const destination = createSimulatedDestination()
    expect(destination.descriptor.simulated).toBe(true)
    const result = await destination.deliver(envelope())
    const view = describeDelivery({ review: 'reviewed', connector: destination.descriptor, delivery: toDeliveryRecord(destination.descriptor, result) })
    expect(view.label).toContain('(simulador)')
  })

  it('recibe una entrega y la registra con la huella que recibió', async () => {
    const destination = createSimulatedDestination()
    const result = await destination.deliver(envelope())
    if (!result.ok) throw new Error('la entrega tenía que salir bien')
    expect(result.duplicate).toBe(false)
    expect(await destination.check(result.receiptId)).toEqual({ found: true, registered: true, contentFingerprint: deliveryFingerprint(CONTENT) })
    expect(destination.inspect()).toHaveLength(1)
  })

  it('la misma entrega dos veces no se registra dos veces: devuelve el mismo comprobante', async () => {
    const destination = createSimulatedDestination()
    const first = await destination.deliver(envelope())
    const second = await destination.deliver(envelope())
    if (!first.ok || !second.ok) throw new Error('las dos tenían que salir bien')
    expect(second.receiptId).toBe(first.receiptId)
    expect(second.duplicate).toBe(true)
    expect(destination.inspect()).toHaveLength(1)
  })

  it('misma clave con otro contenido: se rechaza y lo registrado no cambia', async () => {
    const destination = createSimulatedDestination()
    await destination.deliver(envelope())
    const changed = await destination.deliver(envelope({ content: { ...CONTENT, valor: 9.9 } }))
    expect(changed).toMatchObject({ ok: false, reason: 'conflict', retryable: false })
    expect(destination.inspect()[0]!.contentFingerprint).toBe(deliveryFingerprint(CONTENT))
  })

  it('un sobre cuya huella no corresponde a su contenido se rechaza y no se registra', async () => {
    const destination = createSimulatedDestination()
    const tampered = { ...envelope(), content: { ...CONTENT, valor: 9.9 } }
    expect(await destination.deliver(tampered)).toMatchObject({ ok: false, reason: 'fingerprint_mismatch', retryable: false })
    expect(destination.inspect()).toHaveLength(0)
  })

  it('un sobre cuyo contenido no es JSON plano se rechaza por eso, y no se registra', async () => {
    const destination = createSimulatedDestination()
    const handMade = { ...envelope(), content: { ...CONTENT, tomadaEl: new Date('2026-01-01T00:00:00.000Z') } }
    expect(await destination.deliver(handMade)).toMatchObject({ ok: false, reason: 'non_canonical_content', retryable: false })
    expect(destination.inspect()).toHaveLength(0)
  })

  it('dos contenidos que difieren solo en la fecha de la muestra: el segundo es un conflicto, no un reenvío', async () => {
    const destination = createSimulatedDestination()
    const first = envelope({ content: { ...CONTENT, tomadaEl: '2026-01-01T00:00:00.000Z' } })
    const second = envelope({ content: { ...CONTENT, tomadaEl: '2030-12-31T00:00:00.000Z' } })
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
    expect(second.contentFingerprint).not.toBe(first.contentFingerprint)
    expect(await destination.deliver(first)).toMatchObject({ ok: true, duplicate: false })
    const result = await destination.deliver(second)
    expect(result).toMatchObject({ ok: false, reason: 'conflict', retryable: false })
    expect(toDeliveryRecord(destination.descriptor, result)).toEqual({ connectorId: destination.descriptor.id, stage: 'failed', verified: false })
    expect(destination.inspect()).toHaveLength(1)
    expect(destination.inspect()[0]!.contentFingerprint).toBe(first.contentFingerprint)
  })

  it('si el destino no responde, no queda nada registrado y se puede reintentar', async () => {
    const destination = createSimulatedDestination()
    destination.failNext('unreachable')
    expect(await destination.deliver(envelope())).toMatchObject({ ok: false, reason: 'unreachable', retryable: true })
    expect(destination.inspect()).toHaveLength(0)
    expect((await destination.deliver(envelope())).ok).toBe(true)
  })

  it('un comprobante que el destino no conoce: no encontrado', async () => {
    expect(await createSimulatedDestination().check('no-existe')).toEqual({ found: false, registered: false })
  })

  it('puede recibir sin registrar todavía: «enviado» no es «registrado»', async () => {
    const destination = createSimulatedDestination({ registerOnDelivery: false })
    const result = await destination.deliver(envelope())
    if (!result.ok) throw new Error('la entrega tenía que salir bien')
    expect(await destination.check(result.receiptId)).toMatchObject({ found: true, registered: false })
    destination.confirm(result.receiptId)
    expect(await destination.check(result.receiptId)).toMatchObject({ found: true, registered: true })
  })
})

describe('qué se puede afirmar de una entrega', () => {
  const destination = createSimulatedDestination()
  const { descriptor } = destination

  it('falló: fallida', () => {
    expect(toDeliveryRecord(descriptor, { ok: false, reason: 'unreachable', retryable: true, detail: 'x' })).toEqual({ connectorId: descriptor.id, stage: 'failed', verified: false })
  })

  it('salió bien pero nadie comprobó: enviada, sin verificar', () => {
    expect(toDeliveryRecord(descriptor, { ok: true, receiptId: 'r', duplicate: false })).toEqual({ connectorId: descriptor.id, stage: 'sent', verified: false })
  })

  it('el destino confirmó el registro con la misma huella: registrada y verificada', () => {
    const fp = deliveryFingerprint(CONTENT)
    expect(toDeliveryRecord(descriptor, { ok: true, receiptId: 'r', duplicate: false }, { found: true, registered: true, contentFingerprint: fp }, fp)).toEqual({ connectorId: descriptor.id, stage: 'registered', verified: true })
  })

  it('el destino dice que registró otra cosa: no se da por registrada', () => {
    const record = toDeliveryRecord(descriptor, { ok: true, receiptId: 'r', duplicate: false }, { found: true, registered: true, contentFingerprint: 'otra' }, deliveryFingerprint(CONTENT))
    expect(record).toEqual({ connectorId: descriptor.id, stage: 'sent', verified: false })
  })

  it('un conector que no declara que puede comprobar no da «registrada», aunque le llegue una comprobación con la misma huella', () => {
    const fp = deliveryFingerprint(CONTENT)
    const sinComprobar = { ...descriptor, capabilities: ['deliver_proposal'] as const }
    expect(toDeliveryRecord(sinComprobar, { ok: true, receiptId: 'r', duplicate: false }, { found: true, registered: true, contentFingerprint: fp }, fp)).toEqual({ connectorId: descriptor.id, stage: 'sent', verified: false })
  })

  it('el destino recibió pero todavía no registró: enviada', () => {
    const fp = deliveryFingerprint(CONTENT)
    expect(toDeliveryRecord(descriptor, { ok: true, receiptId: 'r', duplicate: false }, { found: true, registered: false, contentFingerprint: fp }, fp).stage).toBe('sent')
  })
})
