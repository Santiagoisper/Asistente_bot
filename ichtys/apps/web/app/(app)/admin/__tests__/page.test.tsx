import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El registro de auditoría muestra la hora del centro, que es la de la organización: la misma
 * que usan la Agenda y el Inicio. Y la muestra con su zona a la vista, para que quien audita no
 * tenga que adivinar en qué hora está la traza.
 */
const state = vi.hoisted(() => ({ orgId: 'org-buenos-aires' }))

vi.mock('@ichtys/auth/functions', () => ({ allows: () => true }))
vi.mock('@ichtys/auth/study-scope', () => ({ studyScopeFilter: () => undefined, studyScopeOrOrgLevelFilter: () => undefined }))
vi.mock('@ichtys/db', () => ({
  and: () => undefined,
  eq: () => undefined,
  studies: {},
  documents: {},
  documentVersions: {},
  auditLogs: {},
  db: {
    query: {
      studies: { findMany: async () => [] },
      documents: { findMany: async () => [] },
      documentVersions: { findMany: async () => [] },
      auditLogs: {
        findMany: async () => [
          { id: 'evento-1', createdAt: new Date('2026-11-15T20:38:49.318Z'), action: 'evolution.create', resourceType: 'evolution', resourceId: 'evo-inventada' },
        ],
      },
    },
  },
}))
vi.mock('../../../../lib/os/context', () => ({
  getOsContext: async () => ({ userId: 'user_ficticio', orgId: state.orgId, role: 'org_admin', access: {}, studyScope: {} }),
}))
vi.mock('../../../../lib/os/org-settings', () => ({
  loadOrgTimeZone: async (orgId: string) => (orgId === 'org-bogota' ? 'America/Bogota' : 'America/Argentina/Buenos_Aires'),
}))

import AdminPage from '../page'

async function render(orgId: string): Promise<string> {
  state.orgId = orgId
  return renderToStaticMarkup(await AdminPage())
}

describe('administración: la hora del registro de auditoría', () => {
  beforeEach(() => {
    state.orgId = 'org-buenos-aires'
  })

  it('una organización en Buenos Aires la ve en su hora, con la zona a la vista', async () => {
    expect(await render('org-buenos-aires')).toContain('15/11/2026, 17:38:49 (UTC−3)')
  })

  it('una organización en Bogotá ve el mismo evento en la hora de Bogotá, no en la de Buenos Aires', async () => {
    const html = await render('org-bogota')
    expect(html).toContain('15/11/2026, 15:38:49 (UTC−5)')
    expect(html).not.toContain('17:38:49')
  })
})
