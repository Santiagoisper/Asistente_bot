/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VoidedOriginNoticeCard } from '../voided-origin-notice'
import { VOIDED_ORIGIN_TITLE, VOIDED_ORIGIN_UNKNOWN } from '../../../lib/subjects/voided-origin'

/** D24, punto 2: el aviso de lo que entró al perfil desde una evolución anulada. */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function show(props: React.ComponentProps<typeof VoidedOriginNoticeCard>) {
  act(() => {
    root.render(<VoidedOriginNoticeCard {...props} />)
  })
  return container
}

const EVO = '11111111-1111-4111-8111-111111111111'

describe('VoidedOriginNoticeCard', () => {
  it('sin aviso y con la comprobación hecha no muestra nada', () => {
    expect(show({ notice: null, checkFailed: false }).textContent).toBe('')
  })

  it('con aviso: título, los laboratorios por nombre y la advertencia sobre medicaciones y condiciones', () => {
    const el = show({ notice: { labNames: ['HbA1c', 'Glucosa'], evolutionIds: [EVO], acceptedProposal: true, beforeLogging: false }, checkFailed: false })
    expect(el.querySelector('[role="status"]')).not.toBeNull()
    expect(el.textContent).toContain(VOIDED_ORIGIN_TITLE)
    expect(el.textContent).toContain('HbA1c, Glucosa')
    expect(el.textContent).toContain('no guardan de qué evolución vinieron')
    // El identificador de la evolución no es para la persona: no se muestra.
    expect(el.textContent).not.toContain(EVO)
  })

  it('debajo del aviso va lo que la persona puede hacer; sin aviso no se muestra', () => {
    const actions = <button type="button">Revisar el perfil</button>
    expect(show({ notice: { labNames: [], evolutionIds: [EVO], acceptedProposal: true, beforeLogging: false }, checkFailed: false, actions }).textContent).toContain('Revisar el perfil')
    expect(show({ notice: null, checkFailed: false, actions }).textContent).toBe('')
  })

  it('si no se pudo comprobar, lo dice: no afirma que no hay nada', () => {
    const el = show({ notice: null, checkFailed: true })
    expect(el.textContent).toContain(VOIDED_ORIGIN_UNKNOWN)
    expect(el.textContent).not.toContain(VOIDED_ORIGIN_TITLE)
  })

  it('con aviso y la comprobación fallida, muestra el aviso: lo que se sabe alcanza', () => {
    const el = show({ notice: { labNames: ['HbA1c'], evolutionIds: [EVO], acceptedProposal: true, beforeLogging: false }, checkFailed: true })
    expect(el.textContent).toContain(VOIDED_ORIGIN_TITLE)
    expect(el.textContent).not.toContain(VOIDED_ORIGIN_UNKNOWN)
  })
})
