import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rows: vi.fn() }))

vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))
vi.mock('@ichtys/db', () => ({
  organizations: { id: 'id', osSettings: 'os_settings' },
  eq: (column: unknown, value: unknown) => ({ column, value }),
  db: { select: () => ({ from: () => ({ where: (filter: unknown) => ({ limit: () => mocks.rows(filter) }) }) }) },
}))

import { resolveTimeZone } from '../../agenda/agenda-time'
import { loadOrgTimeZone } from '../org-settings'

const BA = 'America/Argentina/Buenos_Aires'

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllEnvs())

describe('zona horaria por organización', () => {
  it('acepta una zona IANA válida y descarta lo que no lo es', () => {
    expect(resolveTimeZone('America/Bogota', BA)).toBe('America/Bogota')
    expect(resolveTimeZone('  Europe/Madrid ', BA)).toBe('Europe/Madrid')
    for (const bad of ['Marte/Olimpo', '', '   ', null, undefined, 42, { timeZone: 'x' }]) expect(resolveTimeZone(bad, BA)).toBe(BA)
  })

  it('cada centro usa la suya, pedida por su id', async () => {
    mocks.rows.mockResolvedValue([{ osSettings: { timeZone: 'America/Bogota' } }])
    expect(await loadOrgTimeZone('org-b')).toBe('America/Bogota')
    expect(mocks.rows).toHaveBeenCalledWith({ column: 'id', value: 'org-b' })
  })

  it('sin ajuste, o con uno inválido, cae en la zona de la instalación', async () => {
    vi.stubEnv('SITE_TIMEZONE', 'America/New_York')
    mocks.rows.mockResolvedValue([{ osSettings: null }])
    expect(await loadOrgTimeZone('org-a')).toBe('America/New_York')
    mocks.rows.mockResolvedValue([{ osSettings: { timeZone: 'no existe' } }])
    expect(await loadOrgTimeZone('org-a')).toBe('America/New_York')
    mocks.rows.mockResolvedValue([])
    expect(await loadOrgTimeZone('org-a')).toBe('America/New_York')
  })

  it('si no se puede leer el ajuste, la Agenda sigue andando con la zona de la instalación', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rows.mockRejectedValue(new Error('column os_settings does not exist'))
    expect(await loadOrgTimeZone('org-a')).toBe(BA)
    error.mockRestore()
  })
})
