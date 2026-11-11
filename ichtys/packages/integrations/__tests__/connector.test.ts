import { describe, expect, it } from 'vitest'
import { describeDelivery, hasCapability, NO_DESTINATION, type ConnectorDescriptor } from '../connector'

const verifiable: ConnectorDescriptor = { id: 'hce', label: 'Historia clínica', simulated: false, capabilities: ['deliver_proposal', 'check_delivery', 'open_record'] }
const blind: ConnectorDescriptor = { id: 'ecrf', label: 'eCRF del sponsor', simulated: false, capabilities: ['deliver_proposal'] }
const simulator: ConnectorDescriptor = { id: 'alpha-cr-sim', label: 'Alpha CR', simulated: true, capabilities: ['deliver_proposal', 'check_delivery'] }

describe('contrato de conector — qué se puede decir de una entrega', () => {
  it('sin sistema de destino: lo revisado queda en Alphi, se dice que no se envió y se puede exportar', () => {
    const view = describeDelivery({ review: 'reviewed', connector: NO_DESTINATION, delivery: null })
    expect(view).toMatchObject({ stage: 'reviewed', label: 'Revisado en Alphi', canExport: true })
    expect(view.detail).toBe('No se envió a ningún otro sistema: no hay sistema de destino configurado.')
    expect(hasCapability(NO_DESTINATION, 'deliver_proposal')).toBe(false)
  })

  it('una propuesta sin revisar o rechazada nunca se exporta ni se da por enviada', () => {
    for (const review of ['proposed', 'rejected'] as const) {
      const view = describeDelivery({ review, connector: verifiable, delivery: { connectorId: 'hce', stage: 'registered', verified: true } })
      expect(view.stage).toBe(review)
      expect(view.canExport).toBe(false)
      expect(view.label).not.toMatch(/Registrad|Enviad/)
    }
  })

  it('revisado y con destino, pero todavía sin enviar', () => {
    const view = describeDelivery({ review: 'reviewed', connector: verifiable, delivery: null })
    expect(view).toMatchObject({ stage: 'reviewed', label: 'Revisado en Alphi' })
    expect(view.detail).toBe('Todavía no se envió a Historia clínica.')
    expect(view.canExport).toBe(false)
  })

  it('"registrado" solo existe si el destino lo confirmó y el conector puede verificarlo', () => {
    expect(describeDelivery({ review: 'reviewed', connector: verifiable, delivery: { connectorId: 'hce', stage: 'registered', verified: true } })).toMatchObject({
      stage: 'registered',
      label: 'Registrado en Historia clínica',
    })
    // Sin verificación, o con un conector que no puede verificar, se dice "enviado": nunca "registrado".
    for (const [connector, delivery] of [
      [verifiable, { connectorId: 'hce', stage: 'registered', verified: false }],
      [blind, { connectorId: 'ecrf', stage: 'registered', verified: true }],
    ] as const) {
      const view = describeDelivery({ review: 'reviewed', connector, delivery })
      expect(view.stage).toBe('sent')
      expect(view.label).toMatch(/^Enviado a /)
      expect(view.label).not.toMatch(/Registrado/)
    }
  })

  it('enviado: dice si el destino va a poder confirmar o no', () => {
    expect(describeDelivery({ review: 'reviewed', connector: verifiable, delivery: { connectorId: 'hce', stage: 'sent', verified: false } }).detail).toBe('Falta que Historia clínica confirme que lo registró.')
    expect(describeDelivery({ review: 'reviewed', connector: blind, delivery: { connectorId: 'ecrf', stage: 'sent', verified: false } }).detail).toBe(
      'eCRF del sponsor no permite verificar si quedó registrado: comprobalo ahí.',
    )
  })

  it('una entrega de otro conector no cuenta', () => {
    const view = describeDelivery({ review: 'reviewed', connector: verifiable, delivery: { connectorId: 'otro', stage: 'registered', verified: true } })
    expect(view.stage).toBe('reviewed')
  })

  it('un simulador siempre se nombra como simulador', () => {
    const view = describeDelivery({ review: 'reviewed', connector: simulator, delivery: { connectorId: 'alpha-cr-sim', stage: 'registered', verified: true } })
    expect(view.label).toBe('Registrado en Alpha CR (simulador)')
    expect(describeDelivery({ review: 'reviewed', connector: simulator, delivery: null }).detail).toContain('Alpha CR (simulador)')
  })

  it('un sistema conectado que no recibe envíos no se confunde con "no hay sistema"', () => {
    const readOnly: ConnectorDescriptor = { id: 'hce-consulta', label: 'Historia clínica', simulated: true, capabilities: ['open_record', 'export'] }
    const view = describeDelivery({ review: 'reviewed', connector: readOnly, delivery: null })
    expect(view).toMatchObject({ stage: 'reviewed', label: 'Revisado en Alphi', canExport: true })
    expect(view.detail).toBe('Historia clínica (simulador) no recibe envíos desde Alphi: hay que cargarlo ahí a mano.')
    // Aunque alguien anote una entrega, un conector que no envía nunca figura como enviado.
    expect(describeDelivery({ review: 'reviewed', connector: readOnly, delivery: { connectorId: 'hce-consulta', stage: 'registered', verified: true } }).stage).toBe('reviewed')
  })

  it('un envío fallido se dice como fallido', () => {
    const view = describeDelivery({ review: 'reviewed', connector: verifiable, delivery: { connectorId: 'hce', stage: 'failed', verified: false } })
    expect(view).toMatchObject({ stage: 'failed', label: 'No se pudo enviar a Historia clínica' })
  })
})
