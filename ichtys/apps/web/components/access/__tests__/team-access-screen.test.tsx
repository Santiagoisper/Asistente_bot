/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberFunction } from '@ichtys/db'
import { ACCESS_EXPIRY_GUIDE, API_ERROR_TEXTS, FUNCTION_LABELS, MODE_TEXTS } from '../../../lib/access/team-ui'
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

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  if (url === '/api/org/team') return Response.json(payload())
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
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<TeamAccessScreen />))
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
