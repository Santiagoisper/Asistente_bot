import { describe, expect, it } from 'vitest'
import { createAgendaItemSchema, updateAgendaItemSchema } from '../agenda-schema'
import { agendaError, countByDay, daySummary, toAgendaCard, type AgendaCard } from '../agenda-view'

const SUBJECT = '22222222-2222-4222-8222-222222222222'
const valid = { subjectId: SUBJECT, title: 'Visita 3', kind: 'visit', day: '2026-11-16', time: '09:30', durationMinutes: 30, notes: null }
const card = (patch: Partial<AgendaCard>): AgendaCard => ({ id: 'a', studyId: 's', studyLabel: 'PROTO-2', subjectCode: '001-001', title: 'Visita 3', kind: 'visit', day: '2026-11-16', time: '09:30', durationMinutes: 30, status: 'scheduled', notes: null, ...patch })

describe('turno nuevo — qué se acepta', () => {
  it('acepta un turno con sujeto y uno sin sujeto', () => {
    expect(createAgendaItemSchema.safeParse(valid).success).toBe(true)
    expect(createAgendaItemSchema.safeParse({ ...valid, subjectId: null, kind: 'monitoring' }).success).toBe(true)
  })

  it('recorta el nombre y deja las notas vacías como null', () => {
    const parsed = createAgendaItemSchema.parse({ ...valid, title: '  Visita 3  ', notes: '   ' })
    expect(parsed).toMatchObject({ title: 'Visita 3', notes: null })
  })

  it('rechaza fechas que no existen, horas fuera de reloj, tipos y campos que no son del contrato', () => {
    const bad = [
      { ...valid, day: '2026-02-30' },
      { ...valid, day: '16/11/2026' },
      { ...valid, time: '25:00' },
      { ...valid, kind: 'cirugia' },
      { ...valid, title: 'V' },
      { ...valid, title: 'x'.repeat(81) },
      { ...valid, durationMinutes: 0 },
      { ...valid, durationMinutes: 30.5 },
      { ...valid, subjectId: 'no-es-uuid' },
      { ...valid, notes: 'x'.repeat(501) },
      { ...valid, organizationId: 'otra-org' },
      { ...valid, studyId: SUBJECT },
    ]
    expect(bad.map((input) => createAgendaItemSchema.safeParse(input).success)).toEqual(bad.map(() => false))
  })
})

describe('cambio de un turno — qué se acepta', () => {
  it('estado solo, o día y hora juntos', () => {
    expect(updateAgendaItemSchema.safeParse({ status: 'done' }).success).toBe(true)
    expect(updateAgendaItemSchema.safeParse({ day: '2026-11-17', time: '10:00' }).success).toBe(true)
    expect(updateAgendaItemSchema.safeParse({ status: 'scheduled', day: '2026-11-17', time: '10:00' }).success).toBe(true)
  })

  it('rechaza un cambio vacío, un día sin hora, un estado desconocido y campos ajenos', () => {
    const bad = [{}, { day: '2026-11-17' }, { time: '10:00' }, { status: 'borrado' }, { status: 'done', title: 'otro' }, { status: 'done', organizationId: 'x' }]
    expect(bad.map((input) => updateAgendaItemSchema.safeParse(input).success)).toEqual(bad.map(() => false))
  })
})

describe('vista de la agenda', () => {
  it('muestra el turno en el día y la hora del sitio', () => {
    const entry = { id: 'a', studyId: 's', studyLabel: 'PROTO-2', subjectId: 'x', subjectCode: '001-001', title: 'Visita 3', kind: 'visit' as const, startsAt: new Date('2026-11-17T02:30:00.000Z'), durationMinutes: 30, status: 'scheduled' as const, notes: null }
    expect(toAgendaCard(entry, 'America/Argentina/Buenos_Aires')).toMatchObject({ day: '2026-11-16', time: '23:30' })
  })

  it('cuenta por día sin los cancelados', () => {
    expect(countByDay([card({}), card({ id: 'b', status: 'cancelled' }), card({ id: 'c', day: '2026-11-17', status: 'done' })])).toEqual({ '2026-11-16': 1, '2026-11-17': 1 })
  })

  it('resume el día', () => {
    expect(daySummary([])).toBe('Sin turnos')
    expect(daySummary([card({ status: 'cancelled' })])).toBe('Sin turnos')
    expect(daySummary([card({}), card({ id: 'b', status: 'done' }), card({ id: 'c', status: 'no_show' }), card({ id: 'd' })])).toBe('4 turnos · 1 hecho · 2 pendientes · 1 ausente')
    expect(daySummary([card({ status: 'done' })])).toBe('1 turno · 1 hecho')
  })

  it('explica cada falla', () => {
    expect(agendaError(400, 'subject_mismatch')).toMatch(/no pertenece/)
    expect(agendaError(403, null)).toMatch(/Tu rol/)
    expect(agendaError(404, 'not_found')).toMatch(/ya no existe/)
    expect(agendaError(500, null)).toMatch(/No se pudo guardar/)
  })
})
