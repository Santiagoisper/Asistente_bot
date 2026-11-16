import { describe, expect, it } from 'vitest'
import { formatDateTime, formatDateTimeWithZone, utcOffsetLabel } from '../date-time'

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires'

/**
 * La hora de un registro se muestra en 24 horas y en la hora del sitio. La zona la pasa siempre
 * quien llama (la de la organización): no hay una por defecto en la que quedarse sin que nadie lo note. En español de Argentina el
 * formato por defecto es de 12 horas y algunos navegadores lo imprimen sin «a. m./p. m.»: una
 * evolución de las 17:38 se leía «05:38».
 */
describe('formatDateTime', () => {
  it('la tarde se muestra en 24 horas: 17:38, no 05:38', () => {
    expect(formatDateTime(new Date('2026-11-15T20:38:49.318Z'), BUENOS_AIRES)).toBe('15/11/2026, 17:38:49')
  })

  it('no depende de la zona del servidor ni de la del navegador: siempre la hora del sitio', () => {
    expect(formatDateTime(new Date('2026-11-16T02:05:00.000Z'), BUENOS_AIRES)).toBe('15/11/2026, 23:05:00')
  })

  it('la medianoche es 00, no 24 ni 12', () => {
    expect(formatDateTime(new Date('2026-11-15T03:00:07.000Z'), BUENOS_AIRES)).toBe('15/11/2026, 00:00:07')
  })

  it('el mediodía es 12', () => {
    expect(formatDateTime(new Date('2026-11-15T15:00:00.000Z'), BUENOS_AIRES)).toBe('15/11/2026, 12:00:00')
  })

  it('acepta el texto ISO que llega de una API', () => {
    expect(formatDateTime('2026-11-15T20:38:49.318Z', BUENOS_AIRES)).toBe('15/11/2026, 17:38:49')
  })

  it('nunca lleva marca de mañana o tarde', () => {
    expect(formatDateTime(new Date('2026-11-15T20:38:49.318Z'), BUENOS_AIRES)).not.toMatch(/[ap]\.?\s?m/i)
  })

  it('con otra zona, la hora de esa zona', () => {
    expect(formatDateTime(new Date('2026-11-15T20:38:49.318Z'), 'UTC')).toBe('15/11/2026, 20:38:49')
    expect(formatDateTime(new Date('2026-11-15T20:38:49.318Z'), 'America/Bogota')).toBe('15/11/2026, 15:38:49')
  })

  it('en otra zona el día también puede ser otro', () => {
    expect(formatDateTime(new Date('2026-11-15T23:30:00.000Z'), 'Europe/Madrid')).toBe('16/11/2026, 00:30:00')
  })
})

/**
 * En el registro de auditoría la hora lleva su zona a la vista: quien audita no tiene que
 * adivinar en qué hora está la traza. Se escribe como diferencia con UTC, que no depende del
 * idioma ni de cómo cada sistema abrevia el nombre de una zona.
 */
describe('formatDateTimeWithZone', () => {
  const instant = new Date('2026-11-15T20:38:49.318Z')

  it('Buenos Aires: tres horas menos que UTC', () => {
    expect(formatDateTimeWithZone(instant, BUENOS_AIRES)).toBe('15/11/2026, 17:38:49 (UTC−3)')
  })

  it('Bogotá: cinco horas menos', () => {
    expect(formatDateTimeWithZone(instant, 'America/Bogota')).toBe('15/11/2026, 15:38:49 (UTC−5)')
  })

  it('una zona adelantada lleva el signo más, y UTC no lleva número', () => {
    expect(formatDateTimeWithZone(instant, 'Europe/Madrid')).toBe('15/11/2026, 21:38:49 (UTC+1)')
    expect(formatDateTimeWithZone(instant, 'UTC')).toBe('15/11/2026, 20:38:49 (UTC)')
  })

  it('una zona con media hora la muestra con sus minutos', () => {
    expect(utcOffsetLabel(instant, 'Asia/Kolkata')).toBe('UTC+5:30')
    expect(utcOffsetLabel(instant, 'America/St_Johns')).toBe('UTC−3:30')
  })

  it('con cambio de hora, la diferencia es la de ese día y no una fija de la zona', () => {
    expect(utcOffsetLabel(new Date('2026-01-15T12:00:00.000Z'), 'America/New_York')).toBe('UTC−5')
    expect(utcOffsetLabel(new Date('2026-07-15T12:00:00.000Z'), 'America/New_York')).toBe('UTC−4')
  })

  it('acepta el texto ISO que llega de una API', () => {
    expect(formatDateTimeWithZone('2026-11-15T20:38:49.318Z', BUENOS_AIRES)).toBe('15/11/2026, 17:38:49 (UTC−3)')
  })
})
