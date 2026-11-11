import { afterEach, describe, expect, it } from 'vitest'
import { isOsEnabled } from '../../flags'
import { greetingFor, sinceLabel } from '../greeting'
import { isNavActive, OS_NAV } from '../nav'
import { isExternalHref, sortPriorityItems, type PriorityItem } from '../priority'
import { escapeLike, normalizeSearchQuery } from '../search-query'

describe('interruptor ALPHI_OS', () => {
  const saved = { vercel: process.env.VERCEL_ENV, os: process.env.ALPHI_OS }
  afterEach(() => {
    if (saved.vercel === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = saved.vercel
    if (saved.os === undefined) delete process.env.ALPHI_OS
    else process.env.ALPHI_OS = saved.os
  })

  it('fuera de producción está encendido', () => {
    process.env.VERCEL_ENV = 'preview'
    delete process.env.ALPHI_OS
    expect(isOsEnabled()).toBe(true)
  })

  it('en producción está apagado salvo ALPHI_OS=on exacto', () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.ALPHI_OS
    expect(isOsEnabled()).toBe(false)
    process.env.ALPHI_OS = 'true'
    expect(isOsEnabled()).toBe(false)
    process.env.ALPHI_OS = 'on'
    expect(isOsEnabled()).toBe(true)
  })
})

describe('saludo en hora de Buenos Aires (UTC-3)', () => {
  it.each([
    ['2026-11-10T08:00:00Z', 'Buen día'], // 05:00
    ['2026-11-10T14:59:00Z', 'Buen día'], // 11:59
    ['2026-11-10T15:00:00Z', 'Buenas tardes'], // 12:00
    ['2026-11-10T22:59:00Z', 'Buenas tardes'], // 19:59
    ['2026-11-10T23:00:00Z', 'Buenas noches'], // 20:00
    ['2026-11-11T07:59:00Z', 'Buenas noches'], // 04:59
  ])('%s → %s', (iso, expected) => {
    expect(greetingFor(new Date(iso))).toBe(expected)
  })

  it('antigüedad legible', () => {
    const now = new Date('2026-11-10T12:00:00Z')
    expect(sinceLabel(null, now)).toBe('sin fecha')
    expect(sinceLabel(new Date('2026-11-10T11:30:00Z'), now)).toBe('recién')
    expect(sinceLabel(new Date('2026-11-10T09:00:00Z'), now)).toBe('hace 3 h')
    expect(sinceLabel(new Date('2026-11-09T11:00:00Z'), now)).toBe('hace 1 día')
    expect(sinceLabel(new Date('2026-11-07T11:00:00Z'), now)).toBe('hace 3 días')
  })
})

describe('menú', () => {
  it('tiene los diez módulos de la captura, en orden', () => {
    expect(OS_NAV.filter((item) => item.group === 'main').map((item) => item.label)).toEqual([
      'Inicio', 'Agenda', 'Visitas', 'Protocolos', 'Laboratorios', 'Queries', 'Operación', 'Viáticos', 'Integraciones', 'Métricas',
    ])
  })

  it('un ítem está activo en su ruta y en sus subrutas, no en rutas que solo empiezan igual', () => {
    const protocolos = OS_NAV.find((item) => item.href === '/studies')!
    expect(isNavActive(protocolos, '/studies')).toBe(true)
    expect(isNavActive(protocolos, '/studies/abc/chat')).toBe(true)
    expect(isNavActive(protocolos, '/studies-otra')).toBe(false)
    expect(isNavActive(protocolos, '/inicio')).toBe(false)
  })
})

describe('atención prioritaria', () => {
  const item = (id: string, severity: PriorityItem['severity'], since: string | null): PriorityItem => ({
    id, kind: 'lab', severity, title: id, detail: '', href: '/x', since,
  })

  it('ordena por gravedad y, a igual gravedad, por lo que espera hace más tiempo', () => {
    const sorted = sortPriorityItems([
      item('media-vieja', 'medium', '2026-11-01T00:00:00Z'),
      item('alta-nueva', 'high', '2026-11-09T00:00:00Z'),
      item('alta-sin-fecha', 'high', null),
      item('alta-vieja', 'high', '2026-11-02T00:00:00Z'),
      item('baja', 'low', '2026-10-01T00:00:00Z'),
    ])
    expect(sorted.map((entry) => entry.id)).toEqual(['alta-vieja', 'alta-nueva', 'alta-sin-fecha', 'media-vieja', 'baja'])
  })

  it('no modifica la lista original', () => {
    const original = [item('b', 'low', null), item('a', 'high', null)]
    sortPriorityItems(original)
    expect(original.map((entry) => entry.id)).toEqual(['b', 'a'])
  })

  it('distingue enlaces del satélite de enlaces internos', () => {
    expect(isExternalHref('https://queries.example.test/x')).toBe(true)
    expect(isExternalHref('/laboratorios')).toBe(false)
  })
})

describe('texto de búsqueda', () => {
  it('escapa los comodines de LIKE', () => {
    expect(escapeLike('100%_real\\')).toBe('100\\%\\_real\\\\')
    expect(escapeLike('EST-201')).toBe('EST-201')
  })

  it('por debajo de 2 caracteres no se busca', () => {
    expect(normalizeSearchQuery(null)).toBeNull()
    expect(normalizeSearchQuery('  a ')).toBeNull()
    expect(normalizeSearchQuery(' ab ')).toBe('ab')
  })

  it('recorta textos larguísimos', () => {
    expect(normalizeSearchQuery('x'.repeat(500))).toHaveLength(80)
  })
})
