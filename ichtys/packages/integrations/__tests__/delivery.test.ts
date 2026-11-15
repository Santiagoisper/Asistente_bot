import { describe, expect, it } from 'vitest'
import { describeDelivery } from '../connector'
import {
  buildDeliveryEnvelope,
  createSimulatedDestination,
  deliveryFingerprint,
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

describe('sobre de entrega', () => {
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

  it('el destino recibió pero todavía no registró: enviada', () => {
    const fp = deliveryFingerprint(CONTENT)
    expect(toDeliveryRecord(descriptor, { ok: true, receiptId: 'r', duplicate: false }, { found: true, registered: false }, fp).stage).toBe('sent')
  })
})
