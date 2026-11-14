/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DICTATION_GUIDE_STEPS } from '@ichtys/clinical'
import { DictationThread } from '../dictation-thread'

/**
 * El hilo de qué decir, junto al botón de grabar (pedido de Santiago, 14/11/2026). En un iPad
 * la guía completa queda debajo del formulario y no se ve mientras se dicta. El hilo sale de
 * las mismas constantes que la guía y el borrador: no enseña ninguna frase que el sistema no reconozca.
 */
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
const show = () => act(() => root.render(<DictationThread />))
const items = () => Array.from(container.querySelectorAll('li'))

describe('DictationThread', () => {
  it('un renglón por apartado, en el orden de la plantilla', () => {
    show()
    expect(items()).toHaveLength(DICTATION_GUIDE_STEPS.length)
    DICTATION_GUIDE_STEPS.forEach((step, index) => {
      if (step.say) expect(items()[index]!.textContent).toContain(`«${step.say}»`)
    })
  })

  it('el primer paso no nombra apartado: muestra qué decir para empezar (la visita y la edad)', () => {
    show()
    const first = items()[0]!.textContent ?? ''
    expect(DICTATION_GUIDE_STEPS[0]!.say).toBeNull()
    expect(first).toContain(DICTATION_GUIDE_STEPS[0]!.example)
    expect(first).not.toContain('«null»')
  })

  it('cada renglón dice para qué es el apartado', () => {
    show()
    DICTATION_GUIDE_STEPS.forEach((step, index) => expect(items()[index]!.textContent).toContain(step.hint))
  })

  it('no enseña ninguna frase entre comillas que no sea de la plantilla', () => {
    show()
    const quoted = Array.from((container.textContent ?? '').matchAll(/«([^»]+)»/g)).map((m) => m[1])
    const known = new Set(DICTATION_GUIDE_STEPS.map((step) => step.say).filter(Boolean))
    expect(quoted.length).toBeGreaterThan(0)
    for (const phrase of quoted) expect(known.has(phrase!)).toBe(true)
  })

  it('dice la regla en una línea: el apartado y después el dato', () => {
    show()
    expect(container.textContent).toContain('Decí el apartado y después el dato')
  })
})
