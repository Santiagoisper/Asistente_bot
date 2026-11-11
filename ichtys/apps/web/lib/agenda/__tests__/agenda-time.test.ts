import { afterEach, describe, expect, it } from 'vitest'
import { addDays, dayKeyInZone, dayLabel, dayRange, isDayKey, isTimeOfDay, shortDayLabel, siteTimeZone, timeInZone, weekOf, zonedToUtc } from '../agenda-time'

const BA = 'America/Argentina/Buenos_Aires'
const NY = 'America/New_York'

describe('fechas de la Agenda', () => {
  const saved = process.env.SITE_TIMEZONE
  afterEach(() => {
    if (saved === undefined) delete process.env.SITE_TIMEZONE
    else process.env.SITE_TIMEZONE = saved
  })

  it('valida días reales y horas de reloj', () => {
    expect(['2026-11-16', '2028-02-29'].every(isDayKey)).toBe(true)
    expect(['2026-02-30', '2026-13-01', '16/11/2026', '2026-1-5', ''].some(isDayKey)).toBe(false)
    expect(['00:00', '09:30', '23:59'].every(isTimeOfDay)).toBe(true)
    expect(['24:00', '9:30', '12:60', 'mediodía'].some(isTimeOfDay)).toBe(false)
  })

  it('las 23:30 de Buenos Aires son del mismo día en el sitio aunque en UTC ya sea mañana', () => {
    const instant = zonedToUtc('2026-11-16', '23:30', BA)
    expect(instant.toISOString()).toBe('2026-11-17T02:30:00.000Z')
    expect(dayKeyInZone(instant, BA)).toBe('2026-11-16')
    expect(timeInZone(instant, BA)).toBe('23:30')
  })

  it('respeta el cambio de hora de una zona que lo tiene', () => {
    expect(zonedToUtc('2026-07-01', '09:00', NY).toISOString()).toBe('2026-07-01T13:00:00.000Z')
    expect(zonedToUtc('2026-12-01', '09:00', NY).toISOString()).toBe('2026-12-01T14:00:00.000Z')
    expect(timeInZone(zonedToUtc('2026-03-08', '12:00', NY), NY)).toBe('12:00')
  })

  it('el día del sitio dura 24 horas y arranca a su medianoche', () => {
    const { start, end } = dayRange('2026-11-16', BA)
    expect(start.toISOString()).toBe('2026-11-16T03:00:00.000Z')
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('suma días cruzando meses y años, y arma la semana de lunes a domingo', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(weekOf('2026-11-11')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'])
    expect(weekOf('2026-11-15')[0]).toBe('2026-11-09')
    expect(weekOf('2026-11-09')[0]).toBe('2026-11-09')
  })

  it('nombra el día en castellano', () => {
    expect(dayLabel('2026-11-16')).toBe('lunes 16 de noviembre')
    expect(shortDayLabel('2026-11-11')).toBe('mié 11')
  })

  it('rechaza una fecha u hora inválida en vez de inventar un instante', () => {
    expect(() => zonedToUtc('2026-02-30', '10:00', BA)).toThrow(RangeError)
    expect(() => zonedToUtc('2026-11-16', '25:00', BA)).toThrow(RangeError)
  })

  it('usa la zona configurada y vuelve a Buenos Aires si no es válida', () => {
    delete process.env.SITE_TIMEZONE
    expect(siteTimeZone()).toBe(BA)
    process.env.SITE_TIMEZONE = NY
    expect(siteTimeZone()).toBe(NY)
    process.env.SITE_TIMEZONE = 'Marte/Olympus'
    expect(siteTimeZone()).toBe(BA)
  })
})
