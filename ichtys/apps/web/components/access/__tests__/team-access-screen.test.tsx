/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberFunction } from '@ichtys/db'
import { ACCESS_EXPIRY_GUIDE, API_ERROR_TEXTS, FUNCTION_LABELS, HISTORY_TEXTS, MODE_TEXTS } from '../../../lib/access/team-ui'
import { TeamAccessScreen, type TeamPayload } from '../team-access-screen'

/**
 * La pantalla contra la API de mentira. Lo que la persona lee (etiquetas de
 * funciones, textos de modo, guía de vencimiento) se compara contra las mismas
 * constantes de team-ui.ts (L6); las acciones se comprueban por el pedido que
 * sale: método, URL y cuerpo. La autorización ya la prueban las suites de las
 * rutas — acá la pantalla parte de datos cargados.
 */

const STUDY = '11111111-1111-4111-8111-111111111111'

function payload(): TeamPayload {
  return {
    mode: 'enforced',
    openUntil: null,
    truncated: false,
    people: [
      {
        userId: 'user-1',
        name: 'Ana Admin',
        identifier: 'ana@centro.test',
        role: 'org_admin',
        functions: ['operations_director'],
        suggestedFunctions: [],
        studies: [],
        authorsWithoutInvestigator: false,
        isSelf: true,
      },
      {
        userId: 'user-2',
        name: 'Beto Médico',
        identifier: 'beto@centro.test',
        role: 'principal_investigator',
        functions: ['monitor'],
        suggestedFunctions: [],
        studies: [{ studyId: STUDY, studyLabel: 'Monitor', expiresAt: '2026-12-01T00:00:00.000Z' }],
        authorsWithoutInvestigator: true,
        isSelf: false,
      },
    ],
    studies: [{ id: STUDY, name: 'Metabólica' }],
    orphanUserIds: ['user-9'],
  }
}

const HISTORY_PAGE_1 = {
  entries: [
    { id: 7, at: '2026-11-12T13:00:00.000Z', action: 'access.function.grant', actorUserId: 'user-1', memberUserId: 'user-2', functionKey: 'monitor', studyId: null, self: false, hasExpiry: null, modeFrom: null, modeTo: null, openUntil: null },
    { id: 6, at: '2026-11-12T12:00:00.000Z', action: 'access.membership.revoke', actorUserId: 'user-1', memberUserId: 'user-9', functionKey: null, studyId: STUDY, self: false, hasExpiry: null, modeFrom: null, modeTo: null, openUntil: null },
  ],
  next: '6',
}
const HISTORY_PAGE_2 = {
  entries: [
    { id: 5, at: '2026-11-11T12:00:00.000Z', action: 'org.access_mode.update', actorUserId: 'user-1', memberUserId: null, functionKey: null, studyId: null, self: false, hasExpiry: null, modeFrom: 'open', modeTo: 'enforced', openUntil: null },
  ],
  next: null,
}

async function defaultFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  if (url === '/api/org/team') return Response.json(payload())
  if (url === '/api/org/team/history') return Response.json(HISTORY_PAGE_1)
  if (url === `/api/org/team/history?before=${encodeURIComponent(HISTORY_PAGE_1.next)}`) return Response.json(HISTORY_PAGE_2)
  if (url === '/api/org/team/mode') {
    // El panel de modo vive adentro de la pantalla: mismo modo que el banner.
    return Response.json({ mode: 'enforced', columnMode: 'enforced', openUntil: null, daysLeft: null, impact: null })
  }
  const method = init?.method ?? 'GET'
  if (url === '/api/org/team/functions') {
    return method === 'POST' ? Response.json({ changed: true, selfAssigned: false }, { status: 201 }) : Response.json({ changed: true })
  }
  if (url === '/api/org/team/memberships') {
    return method === 'POST' ? Response.json({ outcome: 'granted' }, { status: 201 }) : Response.json({ changed: true })
  }
  return Response.json({ error: 'invalid_input' }, { status: 400 })
}
const fetchMock = vi.fn(defaultFetch)

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fetchMock.mockClear()
  // Un test que cambió la implementación no se la deja al siguiente.
  fetchMock.mockImplementation(defaultFetch)
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<TeamAccessScreen timeZone="America/Argentina/Buenos_Aires" />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

/** Espera a que el fetch inicial del efecto termine de pintar el equipo. */
async function settled(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function byLabel(ariaLabel: string): HTMLSelectElement | HTMLInputElement {
  return container.querySelector(`[aria-label="${ariaLabel}"]`) as HTMLSelectElement
}

/**
 * Setea el valor como el usuario: por el setter del prototype (React pisa el
 * del nodo con su valueTracker) y el evento que el control realmente emite
 * ('change' en select, 'input' en el resto). Patrón de upload-form.test.tsx.
 */
function setValue(el: HTMLSelectElement | HTMLInputElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

/** Las llamadas al mock que fueron a esa URL con ese método, como tuplas [input, init]. */
function calls(url: string, method?: string): [RequestInfo | URL, RequestInit | undefined][] {
  return fetchMock.mock.calls.filter(
    ([input, init]) => String(input) === url && (init?.method ?? 'GET') === (method ?? 'GET'),
  ) as [RequestInfo | URL, RequestInit | undefined][]
}

/** El botón con ese texto dentro del cuadro de una persona en particular. */
function buttonInPerson(personName: string, text: string): HTMLButtonElement {
  const article = [...container.querySelectorAll('article')].find((a) => a.textContent?.includes(personName))
  const found = article && [...article.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!found) throw new Error(`no hay botón «${text}» en el cuadro de ${personName}`)
  return found as HTMLButtonElement
}

describe('TeamAccessScreen — lo que se ve', () => {
  it('el equipo completo: personas, funciones, accesos y avisos', async () => {
    await settled()

    const text = container.textContent ?? ''
    expect(text).toContain('Equipo y accesos')
    expect(text).toContain('Ana Admin')
    expect(text).toContain('(vos)') // isSelf
    expect(text).toContain('Beto Médico')
    expect(text).toContain('Metabólica · Monitor · vence')
    expect(text).toContain('Escribió evoluciones y no tiene la función Investigador/a') // M15
    expect(text).toContain('Accesos de personas que ya no están') // orphanUserIds
  })

  it('los textos de modo y la guía salen de las constantes (L6)', async () => {
    await settled()

    const text = container.textContent ?? ''
    expect(text).toContain(MODE_TEXTS.enforced.title)
    expect(text).toContain(MODE_TEXTS.enforced.detail)
    expect(text).toContain(ACCESS_EXPIRY_GUIDE)
    expect(text).toContain(FUNCTION_LABELS.operations_director)
    expect(text).toContain(FUNCTION_LABELS.monitor)
  })

  it('el panel de modo vive en la pantalla, con su propio pedido', async () => {
    await settled()

    expect(container.textContent).toContain('Modo de acceso')
    expect(calls('/api/org/team/mode').length).toBeGreaterThan(0)
  })

  it('el selector ofrece las funciones que faltan, no las vigentes', async () => {
    await settled()

    const expectOffer = (personName: string, active: MemberFunction[]): void => {
      const options = [...byLabel(`Función para ${personName}`).querySelectorAll('option')].map((o) => o.value)
      for (const fn of Object.keys(FUNCTION_LABELS) as MemberFunction[]) {
        if (active.includes(fn)) expect(options, `${personName} ya tiene ${fn}: no se re-asigna`).not.toContain(fn)
        else expect(options, `${personName} sin ${fn}`).toContain(fn)
      }
    }
    expectOffer('Ana Admin', ['operations_director'])
    expectOffer('Beto Médico', ['monitor'])

    const studySelect = byLabel('Estudio para Beto Médico')
    expect([...studySelect.querySelectorAll('option')].map((o) => o.textContent)).toContain('Metabólica')
  })
})

describe('TeamAccessScreen — acciones', () => {
  it('monitor sin fecha de vencimiento: no sale el pedido y se enseña la razón (M4/M18)', async () => {
    await settled()

    setValue(byLabel('Estudio para Beto Médico'), STUDY)
    await act(async () => {
      buttonInPerson('Beto Médico', 'Dar acceso').click()
      await Promise.resolve()
    })

    expect(calls('/api/org/team/memberships', 'POST')).toHaveLength(0) // frenado en la pantalla
    expect(container.textContent).toContain(API_ERROR_TEXTS.monitor_requires_expiry)
  })

  it('con fecha: POST a memberships con el cuerpo justo, y recarga', async () => {
    await settled()
    const getsBefore = calls('/api/org/team').length

    setValue(byLabel('Estudio para Beto Médico'), STUDY)
    setValue(byLabel('Etiqueta en el estudio para Beto Médico'), 'Sub-PI')
    setValue(byLabel('Vencimiento para Beto Médico'), '2026-12-13')
    await act(async () => {
      buttonInPerson('Beto Médico', 'Dar acceso').click()
      await Promise.resolve()
    })

    const posts = calls('/api/org/team/memberships', 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({
      userId: 'user-2',
      studyId: STUDY,
      studyLabel: 'Sub-PI',
      expiresAt: '2026-12-13T00:00:00.000Z',
    })
    expect(container.textContent).toContain('Acceso dado.')
    expect(calls('/api/org/team').length).toBe(getsBefore + 1) // el estado vuelve a ser el del servidor
  })

  it('quitar una función: DELETE a functions con persona y función', async () => {
    await settled()

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[aria-label="Quitar ${FUNCTION_LABELS.operations_director}"]`)?.click()
      await Promise.resolve()
    })

    const deletes = calls('/api/org/team/functions', 'DELETE')
    expect(deletes).toHaveLength(1)
    expect(JSON.parse(String(deletes[0]?.[1]?.body))).toEqual({ userId: 'user-1', functionKey: 'operations_director' })
    expect(container.textContent).toContain('Función quitada.')
  })

  it('un rechazo del servidor se muestra traducido, sin internals', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/org/team') return Response.json(payload())
      return Response.json({ error: 'expiry_in_past' }, { status: 422 })
    })
    await settled()

    setValue(byLabel('Estudio para Ana Admin'), STUDY)
    setValue(byLabel('Vencimiento para Ana Admin'), '2026-12-13')
    await act(async () => {
      buttonInPerson('Ana Admin', 'Dar acceso').click()
      await Promise.resolve()
    })

    expect(container.textContent).toContain(API_ERROR_TEXTS.expiry_in_past)
  })
})

describe('TeamAccessScreen — qué cambió y quién', () => {
  async function historyLoaded(): Promise<void> {
    await settled()
    await settled()
  }

  it('muestra el historial con nombres del equipo; quien ya no está se dice así', async () => {
    await historyLoaded()
    expect(container.textContent).toContain(HISTORY_TEXTS.title)
    expect(container.textContent).toContain(`Ana Admin le asignó a Beto Médico la función «${FUNCTION_LABELS.monitor}».`)
    expect(container.textContent).toContain(`Ana Admin le quitó a ${HISTORY_TEXTS.unknownPerson} el acceso al estudio Metabólica.`)
    // 13:00 UTC se muestra en la hora del centro (UTC−3), en 24 horas.
    expect(container.textContent).toContain('12/11/2026, 10:00:00')
  })

  it('«Ver más» pide la página siguiente con el cursor y la suma abajo', async () => {
    await historyLoaded()
    const more = [...container.querySelectorAll('button')].find((b) => b.textContent === HISTORY_TEXTS.more)!
    await act(async () => {
      more.click()
      await Promise.resolve()
    })
    await settled()
    expect(calls(`/api/org/team/history?before=${encodeURIComponent(HISTORY_PAGE_1.next)}`)).toHaveLength(1)
    expect(container.textContent).toContain('Ana Admin pasó la organización a modo estricto.')
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === HISTORY_TEXTS.more)).toBe(false)
  })

  it('después de guardar un cambio, el historial se vuelve a pedir', async () => {
    await historyLoaded()
    const before = calls('/api/org/team/history').length
    await act(async () => {
      buttonInPerson('Beto Médico', 'Quitar acceso').click()
      await Promise.resolve()
    })
    await historyLoaded()
    expect(calls('/api/org/team/history').length).toBeGreaterThan(before)
  })

  it('si el historial falla, lo dice y el resto de la pantalla sigue', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/org/team') return Response.json(payload())
      if (url.startsWith('/api/org/team/history')) return Response.json({ error: 'x' }, { status: 500 })
      return Response.json({ mode: 'enforced', columnMode: 'enforced', openUntil: null, daysLeft: null, impact: null })
    })
    act(() => root.render(<TeamAccessScreen key="otra" timeZone="America/Argentina/Buenos_Aires" />))
    await historyLoaded()
    expect(container.textContent).toContain(HISTORY_TEXTS.loadFailed)
    expect(container.textContent).toContain('Beto Médico')
  })
})

describe('TeamAccessScreen — límite de pedidos', () => {
  it('un 429 dice que no se guardó y cuánto esperar', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return Response.json({ error: 'rate_limited', retryAfterSeconds: 20 }, { status: 429 })
      return defaultFetch(input, init)
    })
    await settled()
    await act(async () => {
      buttonInPerson('Beto Médico', 'Quitar acceso').click()
      await Promise.resolve()
    })
    await settled()
    expect(container.textContent).toContain('Se hicieron demasiados pedidos seguidos. El cambio no se guardó. Esperá 20 segundos y probá otra vez.')
  })
})
