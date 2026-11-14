/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoidedOriginReviewForm, type RetireChoice } from '../voided-origin-review'

/**
 * D24, 4 bis: la pantalla donde una persona elige qué sale del perfil. Alphi lista y no marca
 * nada por su cuenta; los laboratorios de esa evolución salen siempre; la revisión vacía es una
 * declaración aparte, sin marcar de entrada.
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

const base = {
  subjectCode: 'GZBO-001',
  evolutionLabel: 'la evolución del 14/11/2026',
  labNames: ['Ferritina'],
  ageYears: 61,
  bloodPressure: '150/95',
  medications: ['Metformina', 'Atorvastatina'],
  conditions: ['Diabetes tipo 2', 'Hipotiroidismo'],
  busy: false,
  error: null,
  onCancel: () => {},
}

function show(overrides: Partial<React.ComponentProps<typeof VoidedOriginReviewForm>> = {}) {
  const onSubmit = vi.fn<(choice: RetireChoice) => void>()
  act(() => {
    root.render(<VoidedOriginReviewForm {...base} onSubmit={onSubmit} {...overrides} />)
  })
  return { el: container, onSubmit }
}
const boxes = () => Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
const box = (label: string) => boxes().find((input) => input.closest('label')?.textContent?.includes(label))
const submit = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!
const click = (el: Element) => act(() => (el as HTMLElement).click())

describe('VoidedOriginReviewForm', () => {
  it('de entrada no hay nada marcado: Alphi no elige', () => {
    show()
    expect(boxes().length).toBeGreaterThan(0)
    expect(boxes().every((input) => !input.checked)).toBe(true)
  })

  it('los laboratorios de esa evolución se nombran como lo que sale siempre, sin casilla', () => {
    const { el } = show()
    expect(el.textContent).toContain('Ferritina')
    expect(el.textContent).toContain('salen siempre')
    expect(box('Ferritina')).toBeUndefined()
  })

  it('ofrece la edad y la presión con su valor actual, y cada medicación y condición por su nombre', () => {
    const { el } = show()
    expect(box('61 años')).toBeDefined()
    expect(box('150/95')).toBeDefined()
    for (const name of ['Metformina', 'Atorvastatina', 'Diabetes tipo 2', 'Hipotiroidismo']) expect(box(name)).toBeDefined()
    expect(el.textContent).toContain('GZBO-001')
  })

  it('si el perfil no tiene edad o presión, no ofrece quitarlas', () => {
    show({ ageYears: undefined, bloodPressure: undefined })
    expect(box('años')).toBeUndefined()
    expect(box('Presión')).toBeUndefined()
  })

  it('con laboratorios de ese origen se puede confirmar sin elegir nada más, y la casilla «no hay nada» no se ofrece', () => {
    const { onSubmit } = show()
    expect(box('no hay nada de esa evolución')).toBeUndefined()
    expect(submit().disabled).toBe(false)
    click(submit())
    expect(onSubmit).toHaveBeenCalledWith({ removeAge: false, removeBloodPressure: false, medications: [], conditions: [], nothingToRetire: false })
  })

  it('manda exactamente lo que la persona marcó', () => {
    const { onSubmit } = show()
    click(box('61 años')!)
    click(box('Atorvastatina')!)
    click(box('Hipotiroidismo')!)
    click(submit())
    expect(onSubmit).toHaveBeenCalledWith({ removeAge: true, removeBloodPressure: false, medications: ['Atorvastatina'], conditions: ['Hipotiroidismo'], nothingToRetire: false })
  })

  it('sin laboratorios de ese origen y sin elegir nada, no se puede confirmar: hay que elegir o declarar', () => {
    const { onSubmit } = show({ labNames: [] })
    expect(submit().disabled).toBe(true)
    const nothing = box('no hay nada de esa evolución')
    expect(nothing).toBeDefined()
    expect(nothing!.checked).toBe(false)
    click(nothing!)
    expect(submit().disabled).toBe(false)
    click(submit())
    expect(onSubmit).toHaveBeenCalledWith({ removeAge: false, removeBloodPressure: false, medications: [], conditions: [], nothingToRetire: true })
  })

  it('declarar «no hay nada» y después elegir algo: la declaración se retira sola', () => {
    const { onSubmit } = show({ labNames: [] })
    click(box('no hay nada de esa evolución')!)
    click(box('Metformina')!)
    expect(box('no hay nada de esa evolución')).toBeUndefined()
    click(submit())
    expect(onSubmit).toHaveBeenCalledWith({ removeAge: false, removeBloodPressure: false, medications: ['Metformina'], conditions: [], nothingToRetire: false })
  })

  it('declarar «no hay nada», elegir algo y sacarlo: la casilla vuelve sin marcar y no se manda sola', () => {
    const { onSubmit } = show({ labNames: [] })
    click(box('no hay nada de esa evolución')!)
    click(box('Metformina')!)
    click(box('Metformina')!)
    const back = box('no hay nada de esa evolución')
    expect(back).toBeDefined()
    expect(back!.checked).toBe(false)
    expect(submit().disabled).toBe(true)
    click(submit())
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('si aparece un laboratorio de ese origen mientras estaba declarado «no hay nada» y después se va, la declaración no vuelve sola', () => {
    const { onSubmit } = show({ labNames: [] })
    click(box('no hay nada de esa evolución')!)
    act(() => root.render(<VoidedOriginReviewForm {...base} onSubmit={onSubmit} labNames={['Ferritina']} />))
    act(() => root.render(<VoidedOriginReviewForm {...base} onSubmit={onSubmit} labNames={[]} />))
    expect(box('no hay nada de esa evolución')!.checked).toBe(false)
    expect(submit().disabled).toBe(true)
  })

  it('el botón repite el código del sujeto, y mientras se guarda no se puede mandar dos veces', () => {
    show()
    expect(submit().textContent).toContain('GZBO-001')
    show({ busy: true })
    expect(submit().disabled).toBe(true)
  })

  it('un rechazo se muestra; cancelar no manda nada', () => {
    const onCancel = vi.fn()
    const { el, onSubmit } = show({ error: 'El perfil cambió mientras elegías.', onCancel })
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('El perfil cambió')
    click(Array.from(el.querySelectorAll('button')).find((button) => button.textContent?.includes('Cancelar'))!)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('si una medicación marcada deja de estar en el perfil, deja de contar', () => {
    const { onSubmit } = show()
    click(box('Atorvastatina')!)
    show({ medications: ['Metformina'], onSubmit })
    click(submit())
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ medications: [] }))
  })
})
