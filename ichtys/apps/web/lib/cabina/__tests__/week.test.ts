import { describe, expect, it } from 'vitest'
import { demoStudy } from '../demo-data'
import { parseISODate } from '../schedule'
import { closingWindows, prepForDay, visitsOnDay } from '../week'

const today = parseISODate('2026-11-05')

describe('semana del sitio', () => {
  it('lista las ventanas que todavía están abiertas y cierran dentro de siete días', () => {
    const closing = closingWindows(demoStudy.patients, demoStudy.visits, today)
    expect(closing.find((item) => item.patientCode === '0031' && item.visitKey === 'V4')?.daysUntilClose).toBe(3)
    expect(closing.find((item) => item.patientCode === '0023' && item.visitKey === 'V9')?.daysUntilClose).toBe(2)
    expect(closing.every((item) => item.daysUntilClose >= 0 && item.daysUntilClose <= 7)).toBe(true)
  })

  it('arma la preparación de mañana con lo que sí le corresponde al paciente', () => {
    const tomorrow = parseISODate('2026-11-06')
    const visits = visitsOnDay(demoStudy.patients, demoStudy.visits, today, tomorrow)
    expect(visits.map((item) => `${item.patientCode}:${item.visitKey}`)).toContain('0008:V7')
    const prep = prepForDay(visits, demoStudy.patients, demoStudy.visits, demoStudy.procedures)
    expect(prep).toContain('Avisar el ayuno')
    expect(prep).not.toContain('Frascos de orina de 24 h')
  })
})
