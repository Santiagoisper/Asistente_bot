/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
// El panel de dictado abre micrófono y transcriptor: acá no se prueba.
vi.mock('../dictation-panel', () => ({ DictationPanel: () => null }))

import SubjectEvolutionClient from '../subject-evolution-client'

/**
 * La hora de una evolución se muestra en la zona del centro, que llega desde la página del
 * servidor. No es la del navegador (un monitor en otra ciudad tiene que ver la hora en que el
 * paciente estuvo en el consultorio) ni una fija en el código (la Agenda del mismo centro
 * mostraría el turno en otra hora).
 */
const STUDY = 'd64eeed8-8ba7-4bb0-a875-1bddbaa9a7e9'
const SUBJECT = '96818cbd-09ef-499f-b24b-2cca2a5de462'
const EVO = 'a3f1c2d4-5b6e-4f70-8a9b-0c1d2e3f4a5b'
const CODE = 'ENSAYO-007'
const VOID_ACTION = 'Se registró en el sujeto equivocado'

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/evolutions')) {
        return json({
          subjectCode: CODE,
          evolutions: [{ id: EVO, visitLabel: null, content: 'Texto inventado', voided: null, canVoid: true, dictationTakes: null, createdAt: '2026-11-15T20:38:49.318Z' }],
        })
      }
      if (url.endsWith('/dictation-audios')) return json({ audios: [] })
      if (url.endsWith('/screening')) return json({ profile: { labs: [], medications: [], conditions: [], pendingEvolutionProposals: [] }, assessments: [], specAvailable: false })
      if (url.endsWith('/profile/voided-origin')) return json({ acceptedFrom: [] })
      throw new Error(`pedido que la prueba no esperaba: ${url}`)
    }),
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}
async function mount(timeZone: string) {
  await act(async () => {
    root.render(<SubjectEvolutionClient studyId={STUDY} subjectId={SUBJECT} timeZone={timeZone} />)
  })
  await settle()
}
const shownTime = () => container.querySelector('time')?.textContent ?? ''

describe('historia de evoluciones: la hora se muestra en la zona del centro', () => {
  it('centro en Buenos Aires: 17:38', async () => {
    await mount('America/Argentina/Buenos_Aires')
    expect(shownTime()).toBe('15/11/2026, 17:38:49')
  })

  it('centro en Bogotá: la misma evolución, a las 15:38', async () => {
    await mount('America/Bogota')
    expect(shownTime()).toBe('15/11/2026, 15:38:49')
  })

  it('el dato del elemento sigue siendo el instante guardado, sin convertir', async () => {
    await mount('America/Bogota')
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe('2026-11-15T20:38:49.318Z')
  })

  it('el texto que nombra la evolución al declararla por error usa la misma hora', async () => {
    await mount('America/Bogota')
    const button = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === VOID_ACTION)
    if (!button) throw new Error('falta la acción de declarar el error')
    await act(async () => {
      button.click()
    })
    await settle()
    expect(container.textContent ?? '').toContain('la evolución del 15/11/2026, 15:38:49 no es del sujeto')
  })
})
