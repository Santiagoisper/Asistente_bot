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

type NamedVisit = Pick<ProtocolVisit, 'name' | 'label'>

export interface VisitOption {
  /** Lo que se guarda como rótulo. */
  value: string
  /** Lo que se lee en la lista: el nombre y, si el protocolo la trae, la etiqueta de tiempo. */
  text: string
}

/**
 * El rótulo de cada visita del cronograma, en su orden. Es el nombre de la visita; cuando el
 * protocolo repite un nombre y distingue las visitas por la etiqueta de tiempo («Seguimiento» en la
 * semana 4 y en la semana 8), el rótulo lleva también la etiqueta, para que se pueda elegir cada una
 * y lo guardado diga cuál fue. Dos visitas que no se distinguen ni así quedan como una sola.
 */
function protocolEntries<T extends NamedVisit>(visits: readonly T[]): Array<{ value: string; visit: T }> {
  const count = new Map<string, number>()
  for (const visit of visits) count.set(visit.name.trim(), (count.get(visit.name.trim()) ?? 0) + 1)
  const seen = new Set<string>()
  const entries: Array<{ value: string; visit: T }> = []
  for (const visit of visits) {
    const name = visit.name.trim()
    const label = visit.label?.trim()
    const value = (count.get(name) ?? 0) > 1 && label ? `${name} · ${label}` : name
    if (value.length === 0 || value.length > 100 || seen.has(value)) continue
    seen.add(value)
    entries.push({ value, visit })
  }
  return entries
}

/** Los rótulos de visita que valen para un cronograma: lo que el servidor compara con lo recibido. */
export function protocolVisitLabels(visits: readonly NamedVisit[]): string[] {
  return protocolEntries(visits).map((entry) => entry.value)
}

/** Las opciones que ve quien escribe la evolución. Con cronograma: sus visitas y «No programada». */
export function visitOptions(protocolVisits: readonly NamedVisit[]): VisitOption[] {
  const fromProtocol = protocolEntries(protocolVisits).map(({ value, visit }) => {
    const label = visit.label?.trim()
    return { value, text: label && !value.endsWith(` · ${label}`) ? `${value} · ${label}` : value }
  })
  if (fromProtocol.length === 0) return GENERIC_VISIT_LABELS.map((value) => ({ value, text: value }))
  return fromProtocol.some((option) => option.value === UNSCHEDULED_VISIT)
    ? fromProtocol
    : [...fromProtocol, { value: UNSCHEDULED_VISIT, text: UNSCHEDULED_VISIT }]
}

/**
 * La visita del cronograma que corresponde al rótulo elegido, para la guía de dictado. Es la de la
 * opción elegida, no una búsqueda por parecido: con una lista no hay nada que adivinar. `null` para
 * «Sin indicar», «No programada» y la lista corta, que no tienen visita en el cronograma.
 */
export function visitForLabel<T extends NamedVisit>(label: string, protocolVisits: readonly T[]): T | null {
  return protocolEntries(protocolVisits).find((entry) => entry.value === label)?.visit ?? null
}

/** ¿El rótulo es uno de la lista? Las genéricas valen siempre: un borrador nuevo no invalida lo ya elegido. */
export function isAllowedVisitLabel(label: string, protocolLabels: readonly string[]): boolean {
  return (GENERIC_VISIT_LABELS as readonly string[]).includes(label) || protocolLabels.includes(label)
}
