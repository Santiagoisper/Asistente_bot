/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Panel de consumo (auditoría 19/11, H-08): cupo, avisos por estado, desglose y fallas de carga. */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { UsagePanel } from '../usage-panel'

const fetchMock = vi.fn()
let container: HTMLDivElement
let root: Root
const payload = (quota: Record<string, unknown>, breakdown: unknown[] = []) => ({
  plan: { name: 'Plan base', budgetUsd: 100 },
  period: { start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' },
  quota: { state: 'ok', usedUsd: 10, remainingUsd: 90, percentUsed: 10, warningRatio: 0.8, ...quota },
  breakdown,
  totals: { platformUsd: 10, orgKeyUsd: 2.5, totalUsd: 12.5, platformTokens: 1000, orgKeyTokens: 200, totalTokens: 1200 },
})
const render = async () => {
  await act(async () => root.render(<UsagePanel />))
  for (let i = 0; i < 3; i++) await act(async () => new Promise((r) => setTimeout(r, 0)))
}
const text = () => container.textContent ?? ''

beforeEach(() => {
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

describe('UsagePanel', () => {
  it('dentro del cupo: barra accesible con el porcentaje y lo que queda', async () => {
    fetchMock.mockResolvedValue(Response.json(payload({})))
    await render()
    const bar = container.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-valuenow')).toBe('10')
    expect(text()).toContain('Quedan')
  })

  it('cerca del cupo avisa y sugiere clave propia', async () => {
    fetchMock.mockResolvedValue(Response.json(payload({ state: 'warning', percentUsed: 85, usedUsd: 85, remainingUsd: 15 })))
    await render()
    expect(text()).toContain('Ya usaste el 85%')
    expect(container.querySelector('a[href="/settings"]')).toBeTruthy()
  })

  it('agotado: no muestra «Quedan» y la barra no pasa de 100', async () => {
    fetchMock.mockResolvedValue(Response.json(payload({ state: 'exceeded', percentUsed: 130, usedUsd: 130, remainingUsd: 0 })))
    await render()
    expect(text()).toContain('Se agotó el cupo')
    expect(text()).not.toContain('Quedan')
    expect(container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100')
  })

  it('sin cupo definido: lo dice y no dibuja barra', async () => {
    fetchMock.mockResolvedValue(Response.json(payload({ state: 'no_quota', percentUsed: null, remainingUsd: null })))
    await render()
    expect(text()).toContain('no tiene un cupo mensual')
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('desglose: distingue clave propia y de plataforma', async () => {
    fetchMock.mockResolvedValue(
      Response.json(payload({}, [
        { kind: 'chat', label: 'Chat', keySource: 'org', calls: 3, tokens: 1500, costUsd: 0.5 },
        { kind: 'ingest', label: 'Indexación', keySource: 'platform', calls: 1, tokens: 900, costUsd: 0.1 },
      ])),
    )
    await render()
    const cells = [...container.querySelectorAll('tbody tr')].map((tr) => tr.textContent)
    expect(cells[0]).toContain('Tu org')
    expect(cells[1]).toContain('Plataforma')
  })

  it.each([
    ['respuesta rechazada', () => fetchMock.mockResolvedValue(new Response('', { status: 403 }))],
    ['sin conexión', () => fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))],
  ])('%s: aviso sin romper la pantalla', async (_n, setup) => {
    setup()
    await render()
    expect(text()).toContain('No se pudo cargar el consumo.')
  })
})
