import { describe, expect, it } from 'vitest'
import { orgConnectors, orgModuleUrl, type OrgIntegrationRow } from '../org-modules'

const row = (over: Partial<OrgIntegrationRow>): OrgIntegrationRow => ({
  category: 'module',
  integrationKey: 'queries',
  baseUrl: 'https://queries.centro-a.example.test',
  enabled: true,
  simulated: false,
  ...over,
})

describe('integraciones de una organización', () => {
  it('la URL de un módulo sale de la fila de esa organización', () => {
    expect(orgModuleUrl([row({})], 'queries')).toBe('https://queries.centro-a.example.test')
  })

  it('sin fila, apagado o sin URL: la organización no tiene ese módulo', () => {
    expect(orgModuleUrl([], 'queries')).toBeNull()
    expect(orgModuleUrl([row({ enabled: false })], 'queries')).toBeNull()
    expect(orgModuleUrl([row({ baseUrl: null })], 'queries')).toBeNull()
    expect(orgModuleUrl([row({ baseUrl: '   ' })], 'queries')).toBeNull()
    expect(orgModuleUrl([row({})], 'viaticos')).toBeNull()
  })

  it('una fila de conector con la misma clave no cuenta como módulo', () => {
    expect(orgModuleUrl([row({ category: 'connector' })], 'queries')).toBeNull()
  })

  it('lista los conectores habilitados, y un simulador sigue marcado como simulador', () => {
    const rows = [
      row({}),
      row({ category: 'connector', integrationKey: 'hce-demo', simulated: true }),
      row({ category: 'connector', integrationKey: 'ecrf', enabled: false }),
    ]
    expect(orgConnectors(rows)).toEqual([{ integrationKey: 'hce-demo', baseUrl: 'https://queries.centro-a.example.test', simulated: true }])
  })
})
