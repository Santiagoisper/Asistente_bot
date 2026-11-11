import { agendaItemKind, agendaItemStatus, type AgendaItemKind, type AgendaItemStatus } from '@ichtys/db/enums'
import { z } from 'zod'
import { isDayKey, isTimeOfDay } from './agenda-time'

export const KIND_LABELS: Record<AgendaItemKind, string> = {
  visit: 'Visita',
  lab: 'Laboratorio',
  call: 'Llamado',
  monitoring: 'Monitoreo',
  other: 'Otro',
}

export const STATUS_LABELS: Record<AgendaItemStatus, string> = {
  scheduled: 'Programado',
  done: 'Hecho',
  cancelled: 'Cancelado',
  no_show: 'No vino',
}

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const day = z.string().refine(isDayKey)
const time = z.string().refine(isTimeOfDay)
const title = z.string().trim().min(2).max(80)
const notes = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((value) => (value === null || value.length === 0 ? null : value))
const duration = z.number().int().min(5).max(480)

/** Turno nuevo. El estudio viene de la URL; el sujeto es opcional (un monitoreo no es de un sujeto). */
export const createAgendaItemSchema = z
  .object({
    subjectId: uuid.nullable(),
    title,
    kind: z.enum(agendaItemKind),
    day,
    time,
    durationMinutes: duration,
    notes,
  })
  .strict()
export type CreateAgendaItemInput = z.infer<typeof createAgendaItemSchema>

/** Cambio de un turno: de estado, o de día y hora (los dos juntos). */
export const updateAgendaItemSchema = z
  .object({
    status: z.enum(agendaItemStatus).optional(),
    day: day.optional(),
    time: time.optional(),
  })
  .strict()
  .refine((value) => value.status !== undefined || (value.day !== undefined && value.time !== undefined))
  .refine((value) => (value.day === undefined) === (value.time === undefined))
export type UpdateAgendaItemInput = z.infer<typeof updateAgendaItemSchema>

/** Nombres habituales de un turno, para elegir sin escribir. */
export const TITLE_SUGGESTIONS = ['Screening', 'Basal', 'Visita 1', 'Visita 2', 'Visita 3', 'Visita 4', 'Fin de tratamiento', 'Seguimiento', 'Visita no programada', 'Extracción de sangre', 'Llamado de seguimiento', 'Visita de monitoreo'] as const
