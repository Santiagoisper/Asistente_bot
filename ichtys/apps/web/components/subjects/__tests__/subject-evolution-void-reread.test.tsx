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
import { SCREENING_NOT_READ, VOID_HISTORY_NOT_REREAD } from '../../../lib/subjects/evolution-void-screen'

/**
 * D24, punto 1, después de la declaración. El servidor confirmó (200) que una evolución quedó
 * registrada por error; lo que la pantalla muestra después depende de volver a leer la historia
 * y el perfil. Si esa relectura falla, la copia anterior no se puede seguir mostrando como
 * vigente: ni la acción ofrecida de nuevo, ni la propuesta que el servidor dijo que retiró.
 * Y una lectura del perfil que falla no se calla.
 */
const STUDY = 'd64eeed8-8ba7-4bb0-a875-1bddbaa9a7e9'
const SUBJECT = '96818cbd-09ef-499f-b24b-2cca2a5de462'
const EVO = 'a3f1c2d4-5b6e-4f70-8a9b-0c1d2e3f4a5b'
const OTHER = 'b7e2d3c4-6a5f-4e81-9b0a-1d2c3e4f5a6b'
const CODE = 'ENSAYO-007'
const VOID_ACTION = 'Se registró en el sujeto equivocado'
const DONE = 'Quedó marcada como registrada por error en este sujeto.'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const failed = (status = 500) => json({ error: 'internal_error' }, status)

function evolution(id: string, overrides: Record<string, unknown> = {}) {
  return { id, visitLabel: null, content: `Texto de ${id.slice(0, 4)}`, voided: null, canVoid: true, dictationTakes: null, createdAt: '2026-11-14T15:00:00.000Z', ...overrides }
}
const voidedInfo = { reason: 'wrong_subject', declaredAt: '2026-11-14T21:30:00.000Z' }

function proposal(evolutionId: string, condition: string) {
  return {
    requiresHumanReview: true,
    evolutionId,
    extractedAt: '2026-11-14T15:01:00.000Z',
    facts: { labs: [], medications: [], conditions: [condition] },
  }
}
function screening(proposals: unknown[]) {
  return {
    profile: { labs: [], medications: [], conditions: [], pendingEvolutionProposals: proposals },
    assessments: [],
    specAvailable: false,
  }
}

/** Lo que contesta cada ruta. Cada prueba lo cambia entre un paso y el siguiente. */
let api: {
  evolutions: () => Response | Promise<Response>
  audios: () => Response
  screening: () => Response
  voidedOrigin: () => Response
  void: (evolutionId: string) => Response
}
let calls: string[]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  calls = []
  api = {
    evolutions: () => json({ subjectCode: CODE, evolutions: [evolution(EVO)] }),
    audios: () => json({ audios: [] }),
    screening: () => json(screening([proposal(EVO, 'Hipertensión inventada')])),
    voidedOrigin: () => json({ acceptedFrom: [] }),
    void: () => json({ withdrawnAudios: 0, proposalRetired: true }),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push(`${method} ${url.replace(`/api/studies/${STUDY}/subjects/${SUBJECT}`, '')}`)
      const voidMatch = /\/evolutions\/([^/]+)\/void$/.exec(url)
      if (voidMatch && method === 'POST') return api.void(voidMatch[1]!)
      if (url.endsWith('/evolutions')) return api.evolutions()
      if (url.endsWith('/dictation-audios')) return api.audios()
      if (url.endsWith('/screening')) return api.screening()
      if (url.endsWith('/profile/voided-origin')) return api.voidedOrigin()
      throw new Error(`pedido que la prueba no esperaba: ${method} ${url}`)
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
async function mount() {
  await act(async () => {
    root.render(<SubjectEvolutionClient studyId={STUDY} subjectId={SUBJECT} timeZone="America/Argentina/Buenos_Aires" />)
  })
  await settle()
}
const text = () => container.textContent ?? ''
const buttons = (label: string) => Array.from(container.querySelectorAll('button')).filter((b) => (b.textContent ?? '').trim() === label)
/** La tarjeta de la historia que muestra ese texto de evolución. */
function card(evolutionId: string): HTMLElement {
  const found = Array.from(container.querySelectorAll('li')).find((li) => (li.textContent ?? '').includes(`Texto de ${evolutionId.slice(0, 4)}`))
  if (!found) throw new Error(`no está la tarjeta de ${evolutionId}`)
  return found
}
const within = (element: HTMLElement, label: string) =>
  Array.from(element.querySelectorAll('button')).filter((b) => (b.textContent ?? '').trim() === label)

async function click(button: HTMLElement | undefined) {
  if (!button) throw new Error('falta el botón')
  await act(async () => {
    button.click()
  })
  await settle()
}
/** Abre el diálogo de esa evolución y confirma con el botón que nombra al sujeto. */
async function declare(evolutionId: string) {
  await click(within(card(evolutionId), VOID_ACTION)[0])
  await click(buttons(`Sí, no es de ${CODE}: declarar el error`)[0])
}

describe('después de una declaración confirmada', () => {
  it('antes de declarar: la acción se ofrece y la propuesta está pendiente (punto de partida)', async () => {
    await mount()
    expect(within(card(EVO), VOID_ACTION)).toHaveLength(1)
    expect(text()).toContain('Condición · Hipertensión inventada')
    expect(buttons('Aceptar y sumar al perfil')).toHaveLength(1)
    expect(text()).not.toContain(SCREENING_NOT_READ)
    expect(text()).not.toContain(VOID_HISTORY_NOT_REREAD)
  })

  it('si la historia no se puede volver a leer, la acción no se ofrece de nuevo y la tarjeta dice que quedó como estaba antes', async () => {
    await mount()
    api.evolutions = () => failed(500)
    await declare(EVO)

    expect(calls).toContain(`POST /evolutions/${EVO}/void`)
    const evoCard = card(EVO)
    expect(evoCard.textContent).toContain(DONE)
    // El servidor ya la anuló: ofrecer la acción otra vez es mostrarla como vigente.
    expect(within(evoCard, VOID_ACTION)).toHaveLength(0)
    expect(evoCard.textContent).toContain(VOID_HISTORY_NOT_REREAD)
    expect(text()).toContain('No se pudieron cargar las evoluciones.')
  })

  it('si la historia no se puede volver a leer, la propuesta que el servidor retiró no se sigue ofreciendo y se dice que el perfil no se volvió a leer', async () => {
    await mount()
    api.evolutions = () => failed(500)
    await declare(EVO)

    // Con la historia caída el perfil ni se pide: sigue en pantalla el de antes de declarar.
    expect(calls.filter((c) => c === 'GET /screening')).toHaveLength(1)
    expect(text()).not.toContain('Condición · Hipertensión inventada')
    expect(buttons('Aceptar y sumar al perfil')).toHaveLength(0)
    expect(text()).toContain(SCREENING_NOT_READ)
  })

  it('si la historia se lee y el perfil no, la evolución sale marcada, la propuesta retirada no se ofrece y no se calla', async () => {
    await mount()
    api.evolutions = () => json({ subjectCode: CODE, evolutions: [evolution(EVO, { voided: voidedInfo, canVoid: false })] })
    api.screening = () => failed(500)
    await declare(EVO)

    const evoCard = card(EVO)
    expect(evoCard.textContent).toContain('Registrada por error en este sujeto')
    expect(evoCard.textContent).not.toContain(VOID_HISTORY_NOT_REREAD)
    expect(within(evoCard, VOID_ACTION)).toHaveLength(0)
    expect(text()).not.toContain('Condición · Hipertensión inventada')
    expect(buttons('Aceptar y sumar al perfil')).toHaveLength(0)
    expect(text()).toContain(SCREENING_NOT_READ)
  })

  it('si el servidor no dijo que retiró una propuesta, la que está en pantalla se sigue viendo, con el aviso', async () => {
    await mount()
    api.void = () => json({ withdrawnAudios: 0 })
    api.evolutions = () => failed(500)
    await declare(EVO)

    // Sin `proposalRetired: true` no hay prueba de que se retiró: no se saca de la pantalla.
    expect(text()).toContain('Condición · Hipertensión inventada')
    expect(text()).toContain(SCREENING_NOT_READ)
  })

  it('si las dos lecturas salen bien, no queda ningún aviso de relectura', async () => {
    await mount()
    api.evolutions = () => json({ subjectCode: CODE, evolutions: [evolution(EVO, { voided: voidedInfo, canVoid: false })] })
    api.screening = () => json(screening([]))
    await declare(EVO)

    expect(card(EVO).textContent).toContain('Registrada por error en este sujeto')
    expect(card(EVO).textContent).toContain(DONE)
    expect(text()).not.toContain(VOID_HISTORY_NOT_REREAD)
    expect(text()).not.toContain(SCREENING_NOT_READ)
    expect(text()).not.toContain('Condición · Hipertensión inventada')
  })

  it('una propuesta que aparece después de anular (la extracción llegó tarde) se muestra: la que se oculta es la de la copia vieja', async () => {
    await mount()
    api.evolutions = () => json({ subjectCode: CODE, evolutions: [evolution(EVO, { voided: voidedInfo, canVoid: false })] })
    // Lectura nueva del perfil, posterior a la declaración, que trae una propuesta de esa evolución.
    api.screening = () => json(screening([proposal(EVO, 'Diabetes inventada')]))
    await declare(EVO)

    expect(text()).toContain('Condición · Diabetes inventada')
    expect(buttons('Descartar')).toHaveLength(1)
    expect(text()).not.toContain(SCREENING_NOT_READ)
  })

  it('mientras la relectura está en curso no se afirma que falló; la acción y la propuesta retirada ya no se ofrecen', async () => {
    await mount()
    let release: (response: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    api.evolutions = () => pending
    await declare(EVO)

    expect(card(EVO).textContent).toContain(DONE)
    expect(within(card(EVO), VOID_ACTION)).toHaveLength(0)
    expect(text()).not.toContain('Condición · Hipertensión inventada')
    expect(text()).not.toContain(VOID_HISTORY_NOT_REREAD)
    expect(text()).not.toContain(SCREENING_NOT_READ)

    await act(async () => {
      release(failed(500))
    })
    await settle()
    expect(card(EVO).textContent).toContain(VOID_HISTORY_NOT_REREAD)
    expect(text()).toContain(SCREENING_NOT_READ)
  })

  it('si la declaración no se confirmó (500), nada se da por anulado: la acción sigue y no hay aviso de relectura', async () => {
    await mount()
    api.void = () => failed(500)
    await declare(EVO)

    expect(card(EVO).textContent).toContain('No se pudo confirmar si quedó declarado.')
    expect(card(EVO).textContent).not.toContain(VOID_HISTORY_NOT_REREAD)
    expect(text()).toContain('Condición · Hipertensión inventada')
    expect(text()).not.toContain(SCREENING_NOT_READ)
  })

  it('un rechazo probado (409) tampoco oculta nada', async () => {
    await mount()
    api.void = () => json({ error: 'subject_mismatch' }, 409)
    await declare(EVO)

    expect(card(EVO).textContent).toContain('No se declaró nada')
    expect(card(EVO).textContent).not.toContain(VOID_HISTORY_NOT_REREAD)
    expect(text()).toContain('Condición · Hipertensión inventada')
  })

  it('«ya figuraba» (409) y la historia no se puede volver a leer: está declarada, así que no se ofrece declararla otra vez', async () => {
    await mount()
    api.void = () => json({ error: 'already_voided' }, 409)
    api.evolutions = () => failed(500)
    await declare(EVO)

    expect(card(EVO).textContent).toContain('ya figuraba como registrada por error')
    expect(card(EVO).textContent).toContain(VOID_HISTORY_NOT_REREAD)
    expect(within(card(EVO), VOID_ACTION)).toHaveLength(0)
    // De la propuesta la respuesta no dijo nada: no se saca de la pantalla.
    expect(text()).toContain('Condición · Hipertensión inventada')
  })

  it('cuando una lectura posterior sale bien, los avisos se van y vale lo que trae el servidor', async () => {
    const two = (first: Record<string, unknown>, second: Record<string, unknown>) =>
      json({ subjectCode: CODE, evolutions: [evolution(EVO, first), evolution(OTHER, second)] })
    api.evolutions = () => two({}, {})
    api.screening = () => json(screening([proposal(EVO, 'Hipertensión inventada')]))
    await mount()

    api.evolutions = () => failed(500)
    await declare(EVO)
    expect(card(EVO).textContent).toContain(VOID_HISTORY_NOT_REREAD)
    expect(text()).toContain(SCREENING_NOT_READ)
    // La otra evolución no se tocó: su acción sigue.
    expect(within(card(OTHER), VOID_ACTION)).toHaveLength(1)

    // Segunda declaración, sobre la otra; esta vez la relectura funciona.
    api.evolutions = () => two({ voided: voidedInfo, canVoid: false }, { voided: voidedInfo, canVoid: false })
    api.screening = () => json(screening([]))
    await declare(OTHER)

    expect(text()).not.toContain(VOID_HISTORY_NOT_REREAD)
    expect(text()).not.toContain(SCREENING_NOT_READ)
    expect(card(EVO).textContent).toContain('Registrada por error en este sujeto')
    expect(card(OTHER).textContent).toContain('Registrada por error en este sujeto')
  })
})

describe('una lectura del perfil que falla no se calla', () => {
  it('al abrir la ficha', async () => {
    api.screening = () => failed(500)
    await mount()
    expect(text()).toContain(SCREENING_NOT_READ)
    // La historia se muestra igual.
    expect(card(EVO).textContent).toContain('Texto de a3f1')
  })

  it('si el pedido ni siquiera responde', async () => {
    api.screening = () => {
      throw new Error('sin red')
    }
    await mount()
    expect(text()).toContain(SCREENING_NOT_READ)
  })

  it('después de descartar una propuesta, si la relectura falla', async () => {
    await mount()
    expect(text()).not.toContain(SCREENING_NOT_READ)
    vi.mocked(fetch).mockImplementationOnce(async () => json({ ok: true }))
    api.screening = () => failed(503)
    await click(buttons('Descartar')[0])
    expect(text()).toContain(SCREENING_NOT_READ)
  })

  it('una lectura que sale bien lo quita', async () => {
    api.screening = () => failed(500)
    await mount()
    expect(text()).toContain(SCREENING_NOT_READ)
    // Cualquier relectura que salga bien: acá, la que sigue a una declaración.
    api.evolutions = () => json({ subjectCode: CODE, evolutions: [evolution(EVO, { voided: voidedInfo, canVoid: false })] })
    api.screening = () => json(screening([]))
    await declare(EVO)
    expect(text()).not.toContain(SCREENING_NOT_READ)
  })
})
