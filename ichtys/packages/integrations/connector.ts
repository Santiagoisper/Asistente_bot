/**
 * Contrato de conector: qué puede hacer un sistema de destino (historia
 * clínica, eCRF, grabador…) y qué se puede afirmar de una entrega.
 *
 * El núcleo no conoce a ningún sistema en particular. Un conector declara sus
 * capacidades y el núcleo decide, a partir de ellas, qué texto es honesto
 * mostrar. La regla que no se negocia: "registrado en el destino" solo existe
 * si el destino lo confirmó y el conector es capaz de verificarlo.
 */

export const CONNECTOR_CAPABILITIES = [
  /** Resolver a qué estudio, sujeto y visita del destino corresponde lo propio. */
  'resolve_context',
  /** Traer un documento del destino. */
  'fetch_document',
  /** Entregar una propuesta ya revisada por una persona. */
  'deliver_proposal',
  /** Comprobar en el destino si lo entregado quedó registrado. */
  'check_delivery',
  /** Abrir el registro en el destino para que una persona lo complete. */
  'open_record',
  /** Sacar lo revisado en un archivo o al portapapeles, sin enviar nada. */
  'export',
] as const
export type ConnectorCapability = (typeof CONNECTOR_CAPABILITIES)[number]

export interface ConnectorDescriptor {
  id: string
  /** Nombre del sistema tal como lo conoce quien lo usa. */
  label: string
  /** Simulador de demostración: no hay ningún sistema real detrás. */
  simulated: boolean
  capabilities: readonly ConnectorCapability[]
}

/** Modalidad independiente: el centro no tiene sistema de destino conectado. */
export const NO_DESTINATION: ConnectorDescriptor = {
  id: 'none',
  label: 'Sin sistema de destino',
  simulated: false,
  capabilities: ['export'],
}

export function hasCapability(connector: ConnectorDescriptor, capability: ConnectorCapability): boolean {
  return connector.capabilities.includes(capability)
}

/** Lo que decidió la persona sobre la propuesta. */
export type ReviewState = 'proposed' | 'reviewed' | 'rejected'

/** Lo que se sabe de una entrega a un conector. `verified`: el destino confirmó el registro. */
export interface DeliveryRecord {
  connectorId: string
  stage: 'sent' | 'registered' | 'failed'
  verified: boolean
}

export type DeliveryStage = 'proposed' | 'rejected' | 'reviewed' | 'sent' | 'registered' | 'failed'

export interface DeliveryView {
  stage: DeliveryStage
  label: string
  detail: string
  /** Se puede descargar o copiar: está revisado y el conector lo permite. */
  canExport: boolean
}

function displayName(connector: ConnectorDescriptor): string {
  return connector.simulated ? `${connector.label} (simulador)` : connector.label
}

/**
 * Único lugar que decide qué se dice del estado de una entrega. Cuatro estados
 * que nunca se confunden: propuesta → revisada → enviada → registrada.
 */
export function describeDelivery(input: {
  review: ReviewState
  connector: ConnectorDescriptor
  delivery: DeliveryRecord | null
}): DeliveryView {
  const { review, connector } = input
  if (review === 'proposed') {
    return { stage: 'proposed', label: 'Propuesta sin revisar', detail: 'Falta que una persona la revise.', canExport: false }
  }
  if (review === 'rejected') {
    return { stage: 'rejected', label: 'Rechazado', detail: 'No se guardó ningún valor.', canExport: false }
  }

  const canExport = hasCapability(connector, 'export')
  const name = displayName(connector)
  const delivery = input.delivery?.connectorId === connector.id ? input.delivery : null

  if (!hasCapability(connector, 'deliver_proposal')) {
    return {
      stage: 'reviewed',
      label: 'Revisado en Alphi',
      detail: 'No se envió a ningún otro sistema: no hay sistema de destino configurado.',
      canExport,
    }
  }
  if (!delivery) {
    return { stage: 'reviewed', label: 'Revisado en Alphi', detail: `Todavía no se envió a ${name}.`, canExport }
  }
  if (delivery.stage === 'failed') {
    return { stage: 'failed', label: `No se pudo enviar a ${name}`, detail: 'Sigue revisado en Alphi. Se puede volver a intentar.', canExport }
  }

  const canVerify = hasCapability(connector, 'check_delivery')
  if (delivery.stage === 'registered' && delivery.verified && canVerify) {
    return {
      stage: 'registered',
      label: `Registrado en ${name}`,
      detail: connector.simulated ? 'Es una simulación: no hay ningún sistema real detrás.' : `${connector.label} confirmó el registro.`,
      canExport,
    }
  }
  return {
    stage: 'sent',
    label: `Enviado a ${name}`,
    detail: canVerify
      ? `Falta que ${connector.label} confirme que lo registró.`
      : `${connector.label} no permite verificar si quedó registrado: comprobalo ahí.`,
    canExport,
  }
}
