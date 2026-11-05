import { describe, expect, it } from 'vitest'
import { addDays, diffDays, parseISODate, planVisit, weekAgenda } from '../schedule'
import type { PatientDef, VisitDef } from '../types'

function visit(partial: Partial<VisitDef> & Pick<VisitDef, 'key' | 'timing' | 'window'>): VisitDef {
  return {
    tableKey: 'T1',
    tableTitle: 'Rama principal',
    printedId: partial.key,
    label: partial.key,
    type: 'standard',
    attributes: { fasting: true, onSite: true, armOnly: null },
    annual: false,
    ...partial,
  }
}

const anchor = parseISODate('2026-01-14')

describe('plan de la visita', () => {
  it('una semana son 7 días y la ventana puede ser asimétrica', () => {
    const planned = planVisit(
      visit({
        key: 'V7',
        timing: { kind: 'scheduled', value: 12, unit: 'week', anchor: 'v2', recurrence: null },
        window: { before: 3, after: 7, unit: 'day' },
      }),
      anchor,
      addDays(anchor, 84),
    )
    expect(diffDays(anchor, planned.target!)).toBe(84)
    expect(diffDays(planned.target!, planned.opens!)).toBe(-3)
    expect(diffDays(planned.target!, planned.closes!)).toBe(7)
    expect(planned.status).toBe('verde')
    expect(planned.daysUntilClose).toBe(7)
  })

  it('marca ámbar si la ventana cierra en tres días o todavía no abre', () => {
    const item = visit({
      key: 'V11',
      timing: { kind: 'annual', value: 56, unit: 'week', anchor: 'v2', recurrence: null },
      window: { before: 5, after: 5, unit: 'day' },
    })
    const target = addDays(anchor, 392)
    expect(planVisit(item, anchor, addDays(target, 3)).status).toBe('ambar')
    expect(planVisit(item, anchor, addDays(target, -6)).status).toBe('ambar')
  })

  it('marca rojo cuando la ventana ya cerró', () => {
    const item = visit({
      key: 'V9',
      timing: { kind: 'scheduled', value: 24, unit: 'week', anchor: 'v2', recurrence: null },
      window: { before: 7, after: 7, unit: 'day' },
    })
    const planned = planVisit(item, anchor, addDays(anchor, 24 * 7 + 8))
    expect(planned.status).toBe('rojo')
    expect(planned.daysUntilClose).toBeLessThan(0)
  })

  it('una visita por evento no inventa fecha', () => {
    const planned = planVisit(
      visit({
        key: 'VDT',
        type: 'early_termination',
        timing: { kind: 'event', value: null, unit: null, anchor: 'v2', recurrence: null },
        window: null,
      }),
      anchor,
      anchor,
    )
    expect(planned.status).toBe('sin_fecha')
    expect(planned.target).toBeNull()
  })

  it('el seguimiento recurrente elige la próxima ventana que todavía sirve', () => {
    const item = visit({
      key: 'VR',
      type: 'follow_up',
      timing: {
        kind: 'recurrent',
        value: 12,
        unit: 'week',
        anchor: 'v2',
        recurrence: { every: 12, unit: 'week', untilWeek: 36 },
      },
      window: { before: 7, after: 7, unit: 'day' },
    })
    const today = addDays(anchor, 12 * 7 + 20)
    const planned = planVisit(item, anchor, today)
    expect(diffDays(anchor, planned.target!)).toBe(24 * 7)
    expect(planned.status).toBe('verde')
  })
})

describe('semana del sitio', () => {
  it('arma la semana laboral desde las fechas ancla y el día de hoy', () => {
    const visits = [
      visit({
        key: 'V4',
        timing: { kind: 'scheduled', value: 4, unit: 'week', anchor: 'v2', recurrence: null },
        window: { before: 2, after: 3, unit: 'day' },
      }),
    ]
    const today = parseISODate('2026-11-05')
    const patient: PatientDef = {
      id: 'p',
      code: '0031',
      anchorOffsetDays: -28,
      arm: 'A',
      conditions: { dt2: false, erc: false, ic: false, wocbp: false },
      consents: [],
    }
    const days = weekAgenda([patient], visits, today)
    expect(days).toHaveLength(5)
    expect(days[0]?.label.startsWith('Lun')).toBe(true)
    expect(days.some((day) => day.items.some((item) => item.patientCode === '0031' && item.visitKey === 'V4'))).toBe(true)
  })
})
