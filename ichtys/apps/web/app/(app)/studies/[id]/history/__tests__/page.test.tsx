import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/** El historial de conversaciones muestra la hora del centro, que es la de la organización. */
const state = vi.hoisted(() => ({ orgId: 'org-buenos-aires' }))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ orgId: 'clerk_org_ficticia', userId: 'user_ficticio' }) }))
vi.mock('@ichtys/db', () => ({
  eq: () => undefined,
  organizations: {},
  db: {
    query: {
      organizations: { findFirst: async () => ({ id: state.orgId }) },
      conversations: {
        findMany: async () => [
          { id: 'conversacion-inventada', title: 'Criterios de inclusión', updatedAt: new Date('2026-11-15T20:38:49.318Z'), createdAt: new Date('2026-11-15T20:00:00.000Z') },
        ],
      },
    },
  },
}))
vi.mock('../../../../../../lib/os/org-settings', () => ({
  loadOrgTimeZone: async (orgId: string) => (orgId === 'org-bogota' ? 'America/Bogota' : 'America/Argentina/Buenos_Aires'),
}))

import StudyHistoryPage from '../page'

async function render(orgId: string): Promise<string> {
  state.orgId = orgId
  return renderToStaticMarkup(await StudyHistoryPage({ params: Promise.resolve({ id: 'estudio-inventado' }) }))
}

describe('historial de conversaciones: la hora de la última actualización', () => {
  it('una organización en Buenos Aires la ve en su hora', async () => {
    expect(await render('org-buenos-aires')).toContain('Actualizada: 15/11/2026, 17:38:49')
  })

  it('una organización en Bogotá la ve en la hora de Bogotá', async () => {
    const html = await render('org-bogota')
    expect(html).toContain('Actualizada: 15/11/2026, 15:38:49')
    expect(html).not.toContain('17:38:49')
  })
})
