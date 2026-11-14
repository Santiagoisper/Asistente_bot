/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EvolutionBody, VOIDED_TEXT_WITHHELD } from '../evolution-body'

/** D24: una evolución anulada sigue en la historia, marcada; una corrección no tapa lo escrito. */
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

const VOIDED = { reason: 'wrong_subject', declaredAt: '2026-11-14T15:00:00.000Z' }

function show(props: React.ComponentProps<typeof EvolutionBody>) {
  act(() => {
    root.render(<EvolutionBody {...props} />)
  })
  return container
}

describe('EvolutionBody', () => {
  it('una evolución vigente muestra su texto, sin marca', () => {
    const el = show({ content: 'Paciente estable.', voided: null })
    expect(el.textContent).toBe('Paciente estable.')
    expect(el.querySelector('details')).toBeNull()
  })

  it('una anulada dice que se registró por error y cuándo, y deja el texto plegado', () => {
    const el = show({ content: 'Texto original.', voided: VOIDED })
    expect(el.querySelector('[role="status"]')?.textContent).toContain('Registrada por error en este sujeto')
    const details = el.querySelector('details')
    expect(details).not.toBeNull()
    expect(details!.open).toBe(false)
    expect(details!.textContent).toContain('Texto original.')
  })

  it('si el texto no viajó, lo dice y no ofrece abrirlo', () => {
    const el = show({ content: null, voided: VOIDED })
    expect(el.textContent).toContain('Registrada por error en este sujeto')
    expect(el.textContent).toContain(VOIDED_TEXT_WITHHELD)
    expect(el.querySelector('details')).toBeNull()
  })
})
