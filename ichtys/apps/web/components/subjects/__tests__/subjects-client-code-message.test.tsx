/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SubjectsClient from '../subjects-client'

/**
 * Al rechazar un código de sujeto, la pantalla dice qué está mal. Antes decía «No se pudo crear el
 * sujeto» y nada más (visto el 15/11/2026 en el entorno de prueba con un código de solo números).
 */
let container: HTMLDivElement
let root: Root
const fetchMock = vi.fn()

beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response(JSON.stringify([]), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<SubjectsClient studyId="estudio-ficticio" />)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function submit(code: string) {
  const input = container.querySelector('input') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, code)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')

describe('alta de sujeto: el mensaje dice qué está mal', () => {
  it('un código de solo números se rechaza sin pedir nada al servidor, y dice por qué', async () => {
    await submit('12345')
    expect(posts()).toHaveLength(0)
    expect(container.textContent).toMatch(/solo números|no solo números|letra/i)
    expect(container.textContent).not.toContain('No se pudo crear el sujeto.')
  })

  it('si el servidor lo rechaza por formato, también dice la regla', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 })
        : new Response(JSON.stringify([]), { status: 200 }),
    )
    await submit('ABC-001')
    expect(posts()).toHaveLength(1)
    expect(container.textContent).toMatch(/código del estudio/)
  })

  it('un código válido se manda', async () => {
    await submit('SIM-1511')
    expect(posts()).toHaveLength(1)
  })
})
