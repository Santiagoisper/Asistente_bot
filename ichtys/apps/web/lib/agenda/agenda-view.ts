import type { AgendaItemKind, AgendaItemStatus } from '@ichtys/db/enums'
import type { AgendaEntry } from './agenda-service'
import { dayKeyInZone, timeInZone } from './agenda-time'

/** Turno listo para mostrar: sin fechas crudas, con la hora del sitio. */
export interface AgendaCard {
  id: string
  studyId: string
  studyLabel: string
  subjectCode: string | null
  title: string
  kind: AgendaItemKind
  day: string
  time: string
  durationMinutes: number
  status: AgendaItemStatus
  notes: string | null
}

export function toAgendaCard(entry: AgendaEntry, timeZone: string): AgendaCard {
  return {
    id: entry.id,
    studyId: entry.studyId,
    studyLabel: entry.studyLabel,
    subjectCode: entry.subjectCode,
    title: entry.title,
    kind: entry.kind,
    day: dayKeyInZone(entry.startsAt, timeZone),
    time: timeInZone(entry.startsAt, timeZone),
    durationMinutes: entry.durationMinutes,
    status: entry.status,
    notes: entry.notes,
  }
}

/** Cuántos turnos vigentes (no cancelados) hay por día. */
export function countByDay(cards: AgendaCard[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const card of cards) if (card.status !== 'cancelled') counts[card.day] = (counts[card.day] ?? 0) + 1
  return counts
}

/** Resumen de un día: "3 turnos · 1 hecho · 2 pendientes". */
export function daySummary(cards: AgendaCard[]): string {
  const live = cards.filter((card) => card.status !== 'cancelled')
  if (live.length === 0) return 'Sin turnos'
  const done = live.filter((card) => card.status === 'done').length
  const missed = live.filter((card) => card.status === 'no_show').length
  const pending = live.length - done - missed
  return [
    `${live.length} ${live.length === 1 ? 'turno' : 'turnos'}`,
    done > 0 ? `${done} ${done === 1 ? 'hecho' : 'hechos'}` : null,
    pending > 0 ? `${pending} ${pending === 1 ? 'pendiente' : 'pendientes'}` : null,
    missed > 0 ? `${missed} ${missed === 1 ? 'ausente' : 'ausentes'}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
}

/** Mensaje para una respuesta fallida al guardar un turno. */
export function agendaError(status: number, code: unknown): string {
  if (code === 'subject_mismatch') return 'Ese sujeto no pertenece al estudio elegido.'
  if (status === 400) return 'Revisá el nombre del turno, el día y la hora.'
  if (status === 401 || status === 403) return 'Tu rol no puede agendar turnos en este estudio.'
  if (status === 404) return 'Ese turno ya no existe. Recargá la página.'
  if (status === 503) return 'El cifrado de datos clínicos no está configurado. Avisá a quien administra el sistema.'
  return 'No se pudo guardar el turno. Probá de nuevo.'
}
