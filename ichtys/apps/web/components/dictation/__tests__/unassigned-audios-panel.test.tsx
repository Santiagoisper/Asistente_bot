/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnassignedAudiosPanel } from '../unassigned-audios-panel'

/**
 * «Grabaciones sin sujeto» (D24, punto 3): las que una persona grabó y se retiraron de un
 * sujeto. En Inicio aparece solo si hay alguna; en su página se dice también cuando no hay.
 */
let container: HTMLDivElement
let root: Root
const fetchMock = vi.fn<(url: string) => Promise<Response>>()

const item = (over: Record<string, unknown> = {}) => ({
  id: 'dep-1',
  studyId: 'study-1',
  studyName: 'Estudio GLP-1',
  take: 1,
  durationSec: 95,
  recordedAt: '2026-11-10T12:00:00.000Z',
  withdrawnAt: '2026-11-14T15:00:00.000Z',
  expiresAt: '2026-12-10T12:00:00.000Z',
  available: true,
  ...over,
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  URL.createObjectURL = vi.fn(() => 'blob:grabacion')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function show(variant: 'inicio' | 'page', list: Response | Error) {
  if (list instanceof Error) fetchMock.mockRejectedValueOnce(list)
  else fetchMock.mockResolvedValueOnce(list)
  await act(async () => {
    root.render(<UnassignedAudiosPanel variant={variant} />)
  })
  await act(async () => {})
}
const text = () => container.textContent ?? ''
const button = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(label))
const clickAndSettle = async (el: Element) => {
  const node = el as HTMLElement
  await act(async () => {
    node.click()
  })
  await act(async () => {})
}

describe('UnassignedAudiosPanel', () => {
  it('pide la lista de la persona', async () => {
    await show('page', json({ audios: [] }))
    expect(fetchMock).toHaveBeenCalledWith('/api/dictation-audios/unassigned')
  })

  it('en Inicio, sin grabaciones, no ocupa lugar', async () => {
    await show('inicio', json({ audios: [] }))
    expect(container.innerHTML).toBe('')
  })

  it('en Inicio, si la lista no se pudo leer, lo dice en una línea y lleva a la página: callar sería decir que no hay, y estas grabaciones vencen', async () => {
    await show('inicio', json({}, 500))
    expect(container.querySelector('[role="status"]')?.textContent).toContain('No se pudo comprobar si tenés grabaciones sin sujeto')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/grabaciones-sin-sujeto')
    expect(text()).not.toContain('No tenés grabaciones')
    await show('inicio', new Error('sin red'))
    expect(text()).toContain('No se pudo comprobar')
  })

  it('en Inicio, mientras carga, no ocupa lugar ni afirma nada', async () => {
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}))
    await act(async () => {
      root.render(<UnassignedAudiosPanel variant="inicio" />)
    })
    expect(container.innerHTML).toBe('')
  })

  it('en su página, sin grabaciones, lo dice', async () => {
    await show('page', json({ audios: [] }))
    expect(text()).toContain('No tenés grabaciones sin sujeto')
  })

  it('en su página, si la lista no se pudo leer, lo dice y no dice que no hay', async () => {
    await show('page', json({}, 500))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar')
    expect(text()).not.toContain('No tenés grabaciones')
    await show('page', new Error('sin red'))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar')
  })

  it('con grabaciones: de qué estudio, cuánto dura, cuándo se retiró y cuándo se borra; nunca «no identificada»', async () => {
    await show('inicio', json({ audios: [item()] }))
    expect(text()).toContain('Grabaciones sin sujeto')
    expect(text()).toContain('Estudio GLP-1')
    expect(text()).toContain('1:35')
    expect(text()).toContain(new Date('2026-11-14T15:00:00.000Z').toLocaleDateString('es-AR'))
    expect(text()).toContain(new Date('2026-12-10T12:00:00.000Z').toLocaleDateString('es-AR'))
    expect(text().toLowerCase()).not.toContain('identificad')
    expect(button('Escuchar')).toBeDefined()
  })

  it('dice qué son y que siguen siendo datos clínicos', async () => {
    await show('page', json({ audios: [item()] }))
    expect(text()).toContain('se registró ahí por error')
    expect(text()).toContain('cada escucha queda registrada')
  })

  it('en Inicio va corto y lleva a la página; la explicación completa está en la página', async () => {
    await show('inicio', json({ audios: [item()] }))
    expect(text()).toContain('se registró ahí por error')
    expect(text()).not.toContain('Alphi no las pasa a otro sujeto')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/grabaciones-sin-sujeto')
    await show('page', json({ audios: [item()] }))
    expect(text()).toContain('Alphi no las pasa a otro sujeto')
    expect(container.querySelector('a')).toBeNull()
  })

  it('una vencida queda como constancia y no se ofrece escucharla', async () => {
    await show('page', json({ audios: [item({ available: false })] }))
    expect(text()).toContain('se borró al vencer')
    expect(button('Escuchar')).toBeUndefined()
  })

  it('no se descarga sola: se pide al tocar «Escuchar», y recién ahí aparece el reproductor', async () => {
    await show('page', json({ audios: [item()] }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.querySelector('audio')).toBeNull()
    fetchMock.mockResolvedValueOnce(new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), { status: 200 }))
    await clickAndSettle(button('Escuchar')!)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/dictation-audios/unassigned/dep-1')
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('blob:grabacion')
  })

  it('si venció justo antes de escuchar (410), pasa a constancia', async () => {
    await show('page', json({ audios: [item()] }))
    fetchMock.mockResolvedValueOnce(json({ error: 'audio_expired' }, 410))
    await clickAndSettle(button('Escuchar')!)
    expect(text()).toContain('se borró al vencer')
    expect(button('Escuchar')).toBeUndefined()
  })

  it('si no se pudo cargar, lo dice y se puede volver a intentar (ida y vuelta)', async () => {
    await show('page', json({ audios: [item()] }))
    fetchMock.mockResolvedValueOnce(json({}, 500))
    await clickAndSettle(button('Escuchar')!)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar la grabación')
    fetchMock.mockResolvedValueOnce(new Response(new Blob([new Uint8Array([1])], { type: 'audio/webm' }), { status: 200 }))
    await clickAndSettle(button('Escuchar')!)
    expect(container.querySelector('audio')).not.toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('sin acceso al estudio (403) lo dice con su texto', async () => {
    await show('page', json({ audios: [item()] }))
    fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403 }))
    await clickAndSettle(button('Escuchar')!)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('ya no tenés acceso a ese estudio')
  })
})
