import type { LabObservation } from './profile-schema'

/** Convierte decimales con coma o punto a número. */
export function parseDecimal(raw: string): number {
  return Number.parseFloat(raw.replace(',', '.'))
}

/** Reemplaza el lab con el mismo nombre (case-insensitive) o lo agrega al final. */
export function upsertLab(labs: LabObservation[], entry: LabObservation): LabObservation[] {
  const idx = labs.findIndex((l) => l.name.toLowerCase() === entry.name.toLowerCase())
  if (idx === -1) return [...labs, entry]
  const next = [...labs]
  next[idx] = entry
  return next
}
