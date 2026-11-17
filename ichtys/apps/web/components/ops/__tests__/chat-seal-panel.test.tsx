/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSealPanel } from '../chat-seal-panel'

/**
 * La pantalla de operador del sellado del chat: contar no escribe; sellar queda apagado hasta
 * que se contó y se tildó la base de destino, y el pedido confirma exactamente esa base.
 */
const TARGET = 'ep-prueba.neon.tech/neondb'
const STATUS = { organizations: 2, organizationsWithPlain: 1, messages: 26, plainMessages: 24, plainTitles: 4, annotations: 10, target: TARGET }
const CLEAN = { ...STATUS, organizationsWithPlain: 0, plainMessages: 0, plainTitles: 0, annotations: 0 }
const DONE = { status: 'done', organizations: 1, messages: 24, titles: 4, annotationsCleared: 10, batches: 1, remainingMessages: 0, remainingTitles: 0, remainingAnnotations: 0, blocked: 0 }

let statusPayload: Record<string, unknown>
let postResponse: () => Response
const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
  if ((init?.method ?? 'GET') === 'GET') return Response.json(statusPayload)
  const res = postResponse()
  if (res.ok) statusPayload = CLEAN
  return res
})

let container: HTMLDivElement
let root: Root
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const buttonNamed = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)
const click = async (el: Element | undefined | null) => {
  if (!el) throw new Error('no está el elemento')
  await act(async () => { (el as HTMLElement).click() })
  await flush()
}
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  statusPayload = STATUS
  postResponse = () => Response.json(DONE)
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<ChatSealPanel />) })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('ChatSealPanel', () => {
  it('al abrir no pide nada ni ofrece sellar', () => {
    expect(fetchMock).not.toHaveBeenCalled()
    expect(buttonNamed('Sellar')).toBeUndefined()
    expect(container.textContent).toContain('Primero contá.')
  })

  it('contar muestra las cantidades y la base, y no escribe', async () => {
    await click(buttonNamed('Contar'))
    expect(posts()).toHaveLength(0)
    const text = container.textContent ?? ''
    expect(text).toContain(TARGET)
    expect(text).toContain('Mensajes en claro24')
    expect(text).toContain('Títulos en claro4')
    expect(text).toContain('Mensajes con anotaciones viejas10')
  })

  it('sellar está apagado hasta tildar la base de destino', async () => {
    await click(buttonNamed('Contar'))
    const seal = buttonNamed('Sellar') as HTMLButtonElement
    expect(seal.disabled).toBe(true)
    await click(seal)
    expect(posts()).toHaveLength(0)
    await click(container.querySelector('input[type="checkbox"]'))
    expect((buttonNamed('Sellar') as HTMLButtonElement).disabled).toBe(false)
  })

  it('sellar confirma exactamente la base que devolvió el conteo y muestra el resultado', async () => {
    await click(buttonNamed('Contar'))
    await click(container.querySelector('input[type="checkbox"]'))
    await click(buttonNamed('Sellar'))
    expect(posts()).toHaveLength(1)
    const [url, init] = posts()[0]!
    expect(String(url)).toBe('/api/os/chat-seal')
    expect(JSON.parse(String(init?.body))).toEqual({ confirm: TARGET })
    const text = container.textContent ?? ''
    expect(text).toContain('Terminado: no queda nada en claro.')
    expect(text).toContain('Mensajes sellados24')
    // Volvió a contar: ya no ofrece sellar.
    expect(buttonNamed('Sellar')).toBeUndefined()
    expect(text).toContain('No queda nada en claro en esta base.')
  })

  it('si la clave no sirve lo dice y avisa que no se escribió nada', async () => {
    postResponse = () => Response.json({ error: 'key_mismatch' }, { status: 409 })
    await click(buttonNamed('Contar'))
    await click(container.querySelector('input[type="checkbox"]'))
    await click(buttonNamed('Sellar'))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No se escribió nada')
    expect(container.textContent).not.toContain('Terminado')
  })

  it('un sellado parcial dice que se puede repetir', async () => {
    postResponse = () => Response.json({ ...DONE, status: 'partial', remainingMessages: 5 })
    await click(buttonNamed('Contar'))
    await click(container.querySelector('input[type="checkbox"]'))
    await click(buttonNamed('Sellar'))
    expect(container.textContent).toContain('Quedó una parte sin sellar')
  })
})
