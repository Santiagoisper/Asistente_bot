/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODE_CONFIRM_TEXTS, MODE_DEADLINE_TEXTS, MODE_ERROR_TEXTS, MODE_PANEL_LABELS } from '../../../lib/access/team-ui'
import { ModePanel } from '../mode-panel'

/**
 * El panel de modo contra la API de mentira. Los textos que la persona lee se
 * comparan contra las constantes de team-ui.ts (L6); la confirmación se
 * comprueba por las dos frases (L21) y el pedido que sale (método y cuerpo).
 * Las reglas de fondo las prueban mode-rules y la suite de la ruta.
 */

const DAY = 24 * 60 * 60 * 1000
const isoIn = (days: number): string => new Date(Date.now() + days * DAY).toISOString()

let modePayload: Record<string, unknown>

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  if (url === '/api/org/team/mode' && method === 'GET') return Response.json(modePayload)
  if (url === '/api/org/team/mode' && method === 'PUT') return Response.json({ changed: true })
  return Response.json({ error: 'invalid_input' }, { status: 400 })
})

let container: HTMLDivElement
let root: Root
const onChanged = vi.fn()

/** El payload por defecto: modo abierto con 42 días y Carla afectada. */
function defaultPayload(): Record<string, unknown> {
  return {
    mode: 'open',
    columnMode: 'open',
    openUntil: isoIn(42),
    daysLeft: 42,
    impact: [
      {
        userId: 'user-3',
        name: 'Carla',
        losesStudies: [{ studyId: 'study-1', studyName: 'Metabólica' }],
        losesAllStudies: true,
        stopsAuthoring: true,
      },
    ],
  }
}

/**
 * Monta el panel: cada test lo llama DESPUÉS de armar su payload, así el GET
 * inicial ya ve el caso que le interesa.
 */
function mount(): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<ModePanel onChanged={onChanged} />))
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fetchMock.mockClear()
  onChanged.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  modePayload = defaultPayload()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function settled(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

const button = (text: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!found) throw new Error(`no hay botón «${text}»`)
  return found as HTMLButtonElement
}

describe('ModePanel — lo que se ve', () => {
  it('el plazo restante y las acciones de un modo abierto', async () => {
    mount()
    await settled()

    const text = container.textContent ?? ''
    expect(text).toContain(MODE_PANEL_LABELS.title)
    expect(text).toContain(MODE_DEADLINE_TEXTS.daysLeft(42))
    expect(text).not.toContain(MODE_DEADLINE_TEXTS.expired)
    expect(() => button(MODE_PANEL_LABELS.toEnforcedButton)).not.toThrow()
    expect(text).not.toContain(MODE_PANEL_LABELS.toOpenButton)
  })

  it('en estricto con el plazo vencido: se dice, y no hay vuelta al modo abierto', async () => {
    modePayload = { mode: 'enforced', columnMode: 'enforced', openUntil: isoIn(-3), daysLeft: -3, deadlinePassed: false, impact: null }
    mount()
    await settled()

    const text = container.textContent ?? ''
    expect(text).toContain(MODE_DEADLINE_TEXTS.expired)
    expect(text).not.toContain(MODE_PANEL_LABELS.toOpenButton)
  })

  it('M20: abierto con el plazo vencido — avisa como alerta que sigue abierto y que el cambio lo hace una persona', async () => {
    modePayload = { mode: 'open', columnMode: 'open', openUntil: isoIn(-3), daysLeft: -3, deadlinePassed: true, impact: [] }
    mount()
    await settled()

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe(MODE_DEADLINE_TEXTS.overdue)
    const text = container.textContent ?? ''
    expect(text).not.toContain('quedan -3')
    expect(text).not.toContain(MODE_DEADLINE_TEXTS.expired)
    // El botón para pasar a estricto sigue ahí: es la acción que el aviso pide decidir.
    expect(() => button(MODE_PANEL_LABELS.toEnforcedButton)).not.toThrow()
  })

  it('M20: ningún texto del panel promete que el modo estricto se enciende solo', () => {
    const all = [MODE_DEADLINE_TEXTS.daysLeft(10), MODE_DEADLINE_TEXTS.overdue, MODE_DEADLINE_TEXTS.expired, MODE_CONFIRM_TEXTS.toOpen.risk].join(' ')
    expect(all).not.toMatch(/pasa sola|rige para siempre/)
    expect(MODE_DEADLINE_TEXTS.daysLeft(10)).toContain('no cambia sola')
    expect(MODE_DEADLINE_TEXTS.overdue).toContain('sigue en modo abierto')
  })
})

describe('ModePanel — confirmar el paso a estricto', () => {
  it('muestra las dos frases (L21) y el impacto antes de confirmar; el pedido sale justo', async () => {
    mount()
    await settled()

    await act(async () => {
      button(MODE_PANEL_LABELS.toEnforcedButton).click()
      await Promise.resolve()
    })

    const text = container.textContent ?? ''
    expect(text).toContain(MODE_CONFIRM_TEXTS.toEnforced.gains)
    expect(text).toContain(MODE_CONFIRM_TEXTS.toEnforced.risk)
    expect(text).toContain('Carla')
    expect(text).toContain('Metabólica')
    expect(text).toContain(MODE_PANEL_LABELS.stopsAuthoring)
    expect(text).not.toContain(MODE_PANEL_LABELS.impactEmpty)

    await act(async () => {
      button(MODE_PANEL_LABELS.confirmToEnforced).click()
      await Promise.resolve()
    })

    const puts = fetchMock.mock.calls.filter(
      ([input, init]) => String(input) === '/api/org/team/mode' && init?.method === 'PUT',
    ) as Array<[RequestInfo | URL, RequestInit | undefined]>
    expect(puts).toHaveLength(1)
    expect(JSON.parse(String(puts[0]?.[1]?.body))).toEqual({ mode: 'enforced' })
    expect(container.textContent).toContain(MODE_PANEL_LABELS.okChanged)
    expect(onChanged).toHaveBeenCalled() // la pantalla madre refresca su banner
  })

  it('sin nadie afectado, la confirmación lo dice en lugar de una lista vacía', async () => {
    modePayload = { ...defaultPayload(), impact: [] }
    mount()
    await settled()

    await act(async () => {
      button(MODE_PANEL_LABELS.toEnforcedButton).click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain(MODE_PANEL_LABELS.impactEmpty)
  })

  it('un rechazo del servidor se muestra traducido, sin internals', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/org/team/mode' && (init?.method ?? 'GET') === 'GET') {
        return Response.json(modePayload)
      }
      return Response.json({ error: 'deadline_passed' }, { status: 422 })
    })
    mount()
    await settled()

    await act(async () => {
      button(MODE_PANEL_LABELS.toEnforcedButton).click()
      await Promise.resolve()
    })
    await act(async () => {
      button(MODE_PANEL_LABELS.confirmToEnforced).click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain(MODE_ERROR_TEXTS.deadline_passed)
  })
})
