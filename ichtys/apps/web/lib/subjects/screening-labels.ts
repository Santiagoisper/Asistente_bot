/**
 * El estado de un criterio de elegibilidad, como lo lee quien mira la ficha. El motor habla en
 * pass, fail y unknown; en una exclusión «pass» significa que el criterio no excluye al sujeto.
 */
type Kind = 'inclusion' | 'exclusion'
type Status = 'pass' | 'fail' | 'unknown'

const LABELS: Record<Kind, Record<Status, string>> = {
  inclusion: { pass: 'cumple', fail: 'no cumple', unknown: 'a revisar' },
  exclusion: { pass: 'no excluye', fail: 'excluye', unknown: 'a revisar' },
}

export function criterionStatusLabel(kind: Kind, status: Status): string {
  return LABELS[kind][status]
}
