import type { ProtocolVisit } from '@ichtys/clinical'

/**
 * El rótulo de visita de una evolución se elige de una lista (decisión del 15/11/2026).
 *
 * Se guarda en claro, junto a la fecha, para encontrar la evolución después. Como texto libre
 * nada impedía escribir ahí un dato del sujeto. Ahora sale de las visitas del cronograma del
 * protocolo, o de una lista corta cuando el estudio no tiene cronograma extraído.
 *
 * Este archivo no toca la base: lo usan la pantalla y el servidor. Las visitas del estudio las trae
 * `study-visit-names.ts`.
 */
export const UNSCHEDULED_VISIT = 'No programada'
export const GENERIC_VISIT_LABELS = ['Selección', 'Basal', 'Seguimiento', 'Visita final', UNSCHEDULED_VISIT] as const

export interface VisitOption {
  value: string
  /** Lo que se lee en la lista: el nombre y, si el protocolo la trae, la etiqueta de tiempo. */
  text: string
}

/** Las opciones que ve quien escribe la evolución. Con cronograma: sus visitas y «No programada». */
export function visitOptions(protocolVisits: readonly Pick<ProtocolVisit, 'name' | 'label'>[]): VisitOption[] {
  const seen = new Set<string>()
  const fromProtocol: VisitOption[] = []
  for (const visit of protocolVisits) {
    const value = visit.name.trim()
    if (value.length === 0 || value.length > 100 || seen.has(value)) continue
    seen.add(value)
    fromProtocol.push({ value, text: visit.label ? `${value} · ${visit.label}` : value })
  }
  if (fromProtocol.length === 0) return GENERIC_VISIT_LABELS.map((value) => ({ value, text: value }))
  return seen.has(UNSCHEDULED_VISIT) ? fromProtocol : [...fromProtocol, { value: UNSCHEDULED_VISIT, text: UNSCHEDULED_VISIT }]
}

/** ¿El rótulo es uno de la lista? Las genéricas valen siempre: un borrador nuevo no invalida lo ya elegido. */
export function isAllowedVisitLabel(label: string, protocolVisitNames: readonly string[]): boolean {
  return (GENERIC_VISIT_LABELS as readonly string[]).includes(label) || protocolVisitNames.some((name) => name.trim() === label)
}
