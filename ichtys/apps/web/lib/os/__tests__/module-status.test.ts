import { describe, expect, it } from 'vitest'
import { formatCounter, statusCopy } from '../module-status'

describe('estado de un sistema satélite', () => {
  it('cada estado tiene texto propio y distinto', () => {
    const statuses = ['ok', 'not_configured', 'installation_not_ready', 'unreachable', 'unauthorized', 'invalid_response'] as const
    const labels = statuses.map((status) => statusCopy(status).label)
    expect(new Set(labels).size).toBe(statuses.length)
    expect(statusCopy('not_configured').label).toBe('Sin conectar')
    for (const status of statuses) expect(statusCopy(status).hint.length).toBeGreaterThan(10)
  })

  it('con la dirección cargada y sin clave de la instalación no se le dice al centro que no conectó nada', () => {
    const copy = statusCopy('installation_not_ready')
    expect(copy.tone).toBe('warn')
    expect(copy.hint).toMatch(/dirección del sistema está cargada/)
    expect(copy.hint).not.toMatch(/no está enlazado/)
  })
})

describe('formato de contadores', () => {
  it('los montos se rotulan siempre en dólares estadounidenses', () => {
    expect(formatCounter({ value: 24350, unit: 'usd' })).toBe('USD 24.350')
    expect(formatCounter({ value: 1234.5, unit: 'usd' })).toBe('USD 1.234,5')
  })

  it('porcentajes y cantidades', () => {
    expect(formatCounter({ value: 94, unit: 'percent' })).toBe('94 %')
    expect(formatCounter({ value: 96.25, unit: 'percent' })).toBe('96,3 %')
    expect(formatCounter({ value: 13435, unit: 'count' })).toBe('13.435')
  })
})
