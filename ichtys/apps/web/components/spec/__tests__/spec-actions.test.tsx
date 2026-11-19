/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Acciones de la pantalla del Spec (auditoría 19/11, H-08 y H-21): reintentar la extracción y
 * los mensajes de aprobar. Antes un rechazo al aprobar no decía nada y la cuota agotada se
 * mostraba como «quota_exceeded».
 */
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => nav }))

import { SpecReextractButton, reextractErrorText } from '../spec-reextract-button'
import { specApproveErrorText } from '../spec-review'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const fetchMock = vi.fn()
let container: HTMLDivElement
let root: Root
const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((r) => setTimeout(r, 0)))
}
const text = () => container.textContent ?? ''
const CODES = /quota_exceeded|_|HTTP \d{3}/

beforeEach(() => {
  nav.refresh.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('SpecReextractButton', () => {
  const run = async () => {
    await act(async () => root.render(<SpecReextractButton studyId="st 1" />))
    await act(async () => container.querySelector('button')!.click())
    await flush()
  }

  it('pide la re-extracción del estudio y recarga al terminar', async () => {
    fetchMock.mockResolvedValue(json(200, { status: 'completed', richness: 12 }))
    await run()
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/studies/st%201/spec/reextract')
    expect(text()).toContain('12 ítems')
    expect(nav.refresh).toHaveBeenCalled()
  })

  it('cuota agotada: muestra la frase del servidor, no el código', async () => {
    fetchMock.mockResolvedValue(json(402, { error: 'quota_exceeded', message: 'La cuota mensual de IA de tu organización está agotada. Configurá una clave propia.' }))
    await run()
    expect(text()).toContain('cuota mensual')
    expect(text()).not.toContain('quota_exceeded')
  })

  it('una respuesta que no es JSON no se confunde con un error de red', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }))
    await run()
    expect(text()).toContain('Tu rol no puede')
    expect(text()).not.toContain('Error de red')
  })

  it('sin conexión lo dice', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await run()
    expect(text()).toContain('Error de red')
  })

  it('reextractErrorText nunca devuelve un código suelto', () => {
    for (const status of [400, 401, 402, 403, 404, 409, 422, 429, 500]) {
      expect(reextractErrorText(status, { error: 'some_code' })).not.toMatch(CODES)
    }
    expect(reextractErrorText(422, { error: 'El servicio de IA está saturado.' })).toBe('El servicio de IA está saturado.')
  })
})

describe('specApproveErrorText', () => {
  it.each([
    [401, 'Sesión expirada'],
    [403, 'Tu rol no puede aprobar'],
    [404, 'Tu rol no puede aprobar'],
    [429, 'Esperá un minuto'],
    [500, 'No se pudo aprobar'],
  ])('%i: %s', (status, expected) => {
    expect(specApproveErrorText(status)).toContain(expected)
  })
})

describe('SpecReview — aprobar', () => {
  const spec = { identification: { title: 'Estudio', protocolCode: 'P-1', phase: 'III' }, visits: [], endpoints: [], inclusionCriteria: [], exclusionCriteria: [], procedures: [], arms: [] }
  const renderReview = async () => {
    const { default: SpecReview } = await import('../spec-review')
    await act(async () =>
      root.render(
        <SpecReview specId="sp-1" studyId="st-1" version={2} status="draft" extractionModel="m" createdAt="2026-11-18T10:00:00Z" spec={spec as never} annotatedInclusion={[]} annotatedExclusion={[]} />,
      ),
    )
    await flush()
  }
  const approve = async () => {
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Aprobar spec'))!
    await act(async () => button.click())
    await flush()
  }

  it('si el servidor rechaza, avisa y la spec sigue en borrador', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/approve') ? json(403, {}) : json(200, [])))
    await renderReview()
    await approve()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Tu rol no puede aprobar')
    expect(text()).toContain('Aprobar spec')
  })

  it('aprobada, muestra «Aprobado»', async () => {
    fetchMock.mockImplementation(async () => json(200, []))
    await renderReview()
    await approve()
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/studies/st-1/spec/sp-1/approve' && c[1]?.method === 'POST')).toBe(true)
    expect(text()).toContain('Aprobado')
  })

  it('grupos parciales: sin confirmación no se reenvía; con confirmación se reenvían reconocidos', async () => {
    let approveCalls = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.endsWith('/approve')) return json(200, [])
      approveCalls += 1
      return approveCalls === 1 ? json(409, { error: 'spec_incomplete', groups: ['visits'] }) : json(200, {})
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await renderReview()
    await approve()
    expect(approveCalls).toBe(1)
    approveCalls = 0
    confirm.mockReturnValue(true)
    await approve()
    const resend = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/approve')).at(-1)!
    expect(JSON.parse(resend[1].body)).toEqual({ acknowledgeGroups: ['visits'] })
    confirm.mockRestore()
  })
})
