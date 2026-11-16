import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * «Última comprobación» se muestra en la hora del centro. Esta pantalla es la que configura la
 * zona de la organización: no puede mostrar sus propias horas en otra.
 */
const state = vi.hoisted(() => ({ effective: 'America/Argentina/Buenos_Aires' }))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound')
  },
}))
vi.mock('../../../../components/os/org-config-form', () => ({ OrgConfigForm: () => null }))
vi.mock('../../../../lib/flags', () => ({ isOsEnabled: () => true }))
vi.mock('../../../../lib/os/context', () => ({
  getOsContext: async () => ({ userId: 'user_ficticio', orgId: 'org-ficticia', canAdministerOrg: true }),
}))
vi.mock('../../../../lib/os/org-integrations', () => ({ loadOrgIntegrations: async () => [] }))
vi.mock('../../../../lib/os/org-settings', () => ({
  loadOrgTimeZoneSetting: async () => ({ own: state.effective, effective: state.effective }),
}))
vi.mock('../../../../lib/os/summaries', () => ({
  loadModuleSummary: async (module: string) => ({ module, status: 'ok', summary: null, fetchedAt: '2026-11-15T20:38:49.318Z' }),
}))

import IntegracionesPage from '../page'

async function render(effective: string): Promise<string> {
  state.effective = effective
  return renderToStaticMarkup(await IntegracionesPage())
}

describe('integraciones: la hora de la última comprobación', () => {
  it('una organización en Buenos Aires la ve en su hora, en 24 horas', async () => {
    expect(await render('America/Argentina/Buenos_Aires')).toContain('Última comprobación: 15/11/2026, 17:38:49')
  })

  it('una organización en Bogotá la ve en la hora de Bogotá', async () => {
    const html = await render('America/Bogota')
    expect(html).toContain('Última comprobación: 15/11/2026, 15:38:49')
    expect(html).not.toContain('17:38:49')
  })
})
