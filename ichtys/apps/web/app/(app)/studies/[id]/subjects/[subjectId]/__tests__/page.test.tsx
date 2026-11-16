import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * La ficha del sujeto se dibuja en el navegador, y el navegador no sabe en qué zona trabaja el
 * centro: la página del servidor la carga de la organización y se la pasa al componente.
 */
const state = vi.hoisted(() => ({ orgId: 'org-buenos-aires' }))

vi.mock('@ichtys/auth', () => {
  class AccessError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return { AccessError, validateSubjectAccess: async () => ({ orgId: state.orgId }) }
})
vi.mock('../../../../../../../components/subjects/subject-evolution-client', () => ({
  default: (props: { studyId: string; subjectId: string; timeZone?: string }) => (
    <div data-study={props.studyId} data-subject={props.subjectId} data-time-zone={props.timeZone ?? 'sin zona'} />
  ),
}))
vi.mock('../../../../../../../lib/os/org-settings', () => ({
  loadOrgTimeZone: async (orgId: string) => (orgId === 'org-bogota' ? 'America/Bogota' : 'America/Argentina/Buenos_Aires'),
}))

import SubjectDetailPage from '../page'

async function render(orgId: string): Promise<string> {
  state.orgId = orgId
  return renderToStaticMarkup(await SubjectDetailPage({ params: Promise.resolve({ id: 'estudio-inventado', subjectId: 'sujeto-inventado' }) }))
}

describe('ficha del sujeto: la zona con la que se muestra la hora de una evolución', () => {
  it('le pasa al componente la zona de la organización', async () => {
    expect(await render('org-bogota')).toContain('data-time-zone="America/Bogota"')
    expect(await render('org-buenos-aires')).toContain('data-time-zone="America/Argentina/Buenos_Aires"')
  })
})
