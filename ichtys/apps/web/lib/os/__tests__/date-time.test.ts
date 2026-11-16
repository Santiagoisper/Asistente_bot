import { describe, expect, it } from 'vitest'
import { formatDateTime } from '../date-time'

/**
 * La hora de un registro se muestra en 24 horas y en la hora del sitio. En español de Argentina el
 * formato por defecto es de 12 horas y algunos navegadores lo imprimen sin «a. m./p. m.»: una
 * evolución de las 17:38 se leía «05:38».
 */
describe('formatDateTime', () => {
  it('la tarde se muestra en 24 horas: 17:38, no 05:38', () => {
    expect(formatDateTime(new Date('2026-11-15T20:38:49.318Z'))).toBe('15/11/2026, 17:38:49')
  })

  it('no depende de la zona del servidor ni de la del navegador: siempre la hora del sitio', () => {
    expect(formatDateTime(new Date('2026-11-16T02:05:00.000Z'))).toBe('15/11/2026, 23:05:00')
  })

  it('la medianoche es 00, no 24 ni 12', () => {
    expect(formatDateTime(new Date('2026-11-15T03:00:07.000Z'))).toBe('15/11/2026, 00:00:07')
  })

  it('el mediodía es 12', () => {
    expect(formatDateTime(new Date('2026-11-15T15:00:00.000Z'))).toBe('15/11/2026, 12:00:00')
  })

  it('acepta el texto ISO que llega de una API', () => {
    expect(formatDateTime('2026-11-15T20:38:49.318Z')).toBe('15/11/2026, 17:38:49')
  })

  it('nunca lleva marca de mañana o tarde', () => {
    expect(formatDateTime(new Date('2026-11-15T20:38:49.318Z'))).not.toMatch(/[ap]\.?\s?m/i)
  })

  it('con otra zona, la hora de esa zona', () => {
    expect(formatDateTime(new Date('2026-11-15T20:38:49.318Z'), 'UTC')).toBe('15/11/2026, 20:38:49')
  })
})
