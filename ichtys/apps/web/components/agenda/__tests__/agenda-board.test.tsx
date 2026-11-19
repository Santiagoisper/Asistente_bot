/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tablero de la Agenda (auditoría 19/11, H-08): qué se manda al cambiar un turno, quién ve los
 * controles, el alta con sujeto opcional y los mensajes cuando el servidor rechaza.
 */
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => nav }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

import { AgendaBoard } from '../agenda-board'
import type { AgendaCard } from '../../../lib/agenda/agenda-view'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const fetchMock = vi.fn()
let container: HTMLDivElement
let root: Root

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((r) => setTimeout(r, 0)))
}
const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const click = async (el: Element | undefined) => {
  await act(async () => (el as HTMLElement).click())
  await flush()
}
const setValue = async (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
const text = () => container.textContent ?? ''

const card = (over: Partial<AgendaCard> = {}): AgendaCard => ({
  id: 'ag-1',
  studyId: 'st-1',
  studyLabel: 'P-100',
  subjectCode: '001-004',
  title: 'Visita 3',
  kind: 'visit',
  day: '2026-11-19',
  time: '09:30',
  durationMinutes: 30,
  status: 'scheduled',
  notes: null,
  ...over,
})
const week = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
const render = async (props: Partial<React.ComponentProps<typeof AgendaBoard>> = {}) => {
  await act(async () =>
    root.render(
      <AgendaBoard day="2026-11-19" today="2026-11-19" week={week} counts={{}} cards={[card()]} studies={[{ id: 'st-1', label: 'P-100' }]} canEdit {...props} />,
    ),
  )
  await flush()
}

beforeEach(() => {
  nav.push.mockReset()
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

describe('AgendaBoard', () => {
  it('quien no puede editar no ve ningún control de cambio', async () => {
    await render({ canEdit: false })
    for (const label of ['Marcar hecho', 'No vino', 'Reprogramar', 'Cancelar turno']) expect(button(label)).toBeUndefined()
    expect(text()).not.toContain('Agendar')
  })

  it.each([
    ['Marcar hecho', { status: 'done' }],
    ['No vino', { status: 'no_show' }],
    ['Cancelar turno', { status: 'cancelled' }],
  ])('«%s» manda solo el estado nuevo al turno de ese estudio', async (label, body) => {
    fetchMock.mockResolvedValue(json(200, {}))
    await render()
    await click(button(label))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/studies/st-1/agenda/ag-1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual(body)
    expect(nav.refresh).toHaveBeenCalled()
  })

  it('reprogramar manda día y hora nuevos', async () => {
    fetchMock.mockResolvedValue(json(200, {}))
    await render()
    await click(button('Reprogramar'))
    const [dayInput, timeInput] = [...container.querySelectorAll<HTMLInputElement>('li input')]
    await setValue(dayInput!, '2026-11-21')
    await setValue(timeInput!, '11:15')
    await click(button('Guardar'))
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ day: '2026-11-21', time: '11:15' })
  })

  it.each([
    [403, 'Tu rol no puede agendar'],
    [404, 'ya no existe'],
    [429, 'Esperá un minuto'],
  ])('si el servidor rechaza (%i), avisa y no recarga', async (status, expected) => {
    fetchMock.mockResolvedValue(json(status, {}))
    await render()
    await click(button('Marcar hecho'))
    expect(text()).toContain(expected)
    expect(nav.refresh).not.toHaveBeenCalled()
  })

  it('un turno ya hecho solo se puede volver a programado', async () => {
    await render({ cards: [card({ status: 'done' })] })
    expect(button('Volver a programado')).toBeTruthy()
    expect(button('Reprogramar')).toBeUndefined()
    expect(button('Marcar hecho')).toBeUndefined()
  })

  it('alta: carga los sujetos del estudio, el sujeto es opcional y el título va recortado', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/studies/st-1/subjects') return json(200, [{ id: 'su-2', subjectCode: '001-002' }])
      if (url === '/api/studies/st-1/agenda' && init?.method === 'POST') return json(201, { id: 'ag-new' })
      return json(404, {})
    })
    await render()
    await click([...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Agendar')))
    expect(container.querySelector('select option[value="su-2"]')).toBeTruthy()
    const title = [...container.querySelectorAll<HTMLInputElement>('form input')].find((i) => i.id.endsWith('-title'))!
    await setValue(title, '  Llamado de seguimiento  ')
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await flush()
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toMatchObject({ subjectId: null, title: 'Llamado de seguimiento', day: '2026-11-19', notes: null })
    expect(nav.refresh).toHaveBeenCalled()
  })

  it('alta: si no se pudo cargar la lista de sujetos lo dice y deja reintentar', async () => {
    fetchMock.mockResolvedValue(json(500, {}))
    await render()
    await click([...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Agendar')))
    expect(button('Reintentar') ?? [...container.querySelectorAll('button')].find((b) => /intent/i.test(b.textContent ?? ''))).toBeTruthy()
  })
})
