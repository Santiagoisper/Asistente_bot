/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EvolutionVoidControl, type VoidConfirmation } from '../evolution-void-control'

/**
 * D24, punto 1: declarar desde la historia que una evolución se registró en el sujeto
 * equivocado. Es definitivo, así que la persona confirma el sujeto con un botón que lo nombra
 * (como D23), y antes lee qué va a pasar.
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
  voided: false,
  allowed: true,
  open: false,
  busy: false,
  feedback: null,
}

type Props = React.ComponentProps<typeof EvolutionVoidControl>
function show(overrides: Partial<Props> = {}) {
  const onOpen = vi.fn()
  const onCancel = vi.fn()
  const onConfirm = vi.fn<(confirmation: VoidConfirmation) => void>()
  const props = { ...base, onOpen, onCancel, onConfirm, ...overrides }
  act(() => root.render(<EvolutionVoidControl {...props} />))
  return { onOpen, onCancel, onConfirm, rerender: (next: Partial<Props>) => act(() => root.render(<EvolutionVoidControl {...props} {...next} />)) }
}
const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
const button = (text: string) => buttons().find((b) => b.textContent?.includes(text))
const note = () => container.querySelector<HTMLTextAreaElement>('textarea')
const click = (el: Element) => act(() => (el as HTMLElement).click())
function type(el: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('EvolutionVoidControl', () => {
  it('cerrado: ofrece la acción con sus palabras y no manda nada', () => {
    const { onOpen, onConfirm } = show()
    const open = button('Se registró en el sujeto equivocado')
    expect(open).toBeDefined()
    expect(note()).toBeNull()
    click(open!)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('con otra declaración en curso la acción se ve deshabilitada: no ignora el toque en silencio', () => {
    const { onOpen } = show({ busy: true })
    const open = button('Se registró en el sujeto equivocado')!
    expect(open.disabled).toBe(true)
    click(open)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a quien la historia no le dice que puede, no se le ofrece nada, ni abierto', () => {
    show({ allowed: false })
    expect(buttons()).toHaveLength(0)
    show({ allowed: false, open: true })
    expect(buttons()).toHaveLength(0)
    expect(note()).toBeNull()
  })

  it('aunque ya no pueda, lo que pasó con su intento se le sigue diciendo', () => {
    show({ allowed: false, feedback: { kind: 'error', text: 'No se declaró nada.' } })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('No se declaró nada.')
    expect(buttons()).toHaveLength(0)
  })

  it('sobre una evolución ya anulada no se ofrece nada, ni abierto', () => {
    show({ voided: true, open: true })
    expect(buttons()).toHaveLength(0)
    expect(note()).toBeNull()
  })

  it('abierto: nombra al sujeto y a la evolución, dice que es definitivo y qué pasa', () => {
    show({ open: true })
    const text = container.textContent ?? ''
    expect(text).toContain('GZBO-001')
    expect(text).toContain('la evolución del 14/11/2026')
    expect(text).toContain('No tiene vuelta atrás')
    expect(text).toContain('Registrada por error en este sujeto')
    expect(text).toContain('grabaciones sin sujeto')
    // Lo que se dice de escucharlas es lo que hoy existe: quien las grabó, desde su lista.
    expect(text).toContain('las siguen pudiendo escuchar quien las grabó y quien coordina el estudio')
    expect(text).not.toContain('Todavía no hay')
    expect(text).toContain('El perfil no se corrige solo')
  })

  it('el botón que confirma repite el código del sujeto, y manda ese código', () => {
    const { onConfirm } = show({ open: true })
    const confirm = button('GZBO-001')
    expect(confirm).toBeDefined()
    expect(confirm!.textContent).toContain('no es de GZBO-001')
    click(confirm!)
    expect(onConfirm).toHaveBeenCalledWith({ confirmedSubjectCode: 'GZBO-001' })
  })

  it('si el sujeto todavía no cargó, no hay nada que confirmar', () => {
    for (const subjectCode of ['', '…', '   ']) {
      const { onConfirm } = show({ open: true, subjectCode })
      const confirm = buttons().find((b) => b.type === 'button' && b.textContent?.includes('Cargando el sujeto'))
      expect(confirm).toBeDefined()
      expect(confirm!.disabled).toBe(true)
      click(confirm!)
      expect(onConfirm).not.toHaveBeenCalled()
    }
  })

  it('si el sujeto en pantalla cambia con el diálogo abierto, se confirma el que el botón nombra en ese momento', () => {
    const { onConfirm, rerender } = show({ open: true })
    rerender({ subjectCode: 'GZBO-002' })
    expect(button('GZBO-001')).toBeUndefined()
    click(button('GZBO-002')!)
    expect(onConfirm).toHaveBeenCalledWith({ confirmedSubjectCode: 'GZBO-002' })
  })

  it('el motivo es opcional, va recortado y tiene tope', () => {
    const { onConfirm } = show({ open: true })
    expect(note()!.maxLength).toBe(500)
    type(note()!, '  Era la consulta de otro paciente.  ')
    click(button('GZBO-001')!)
    expect(onConfirm).toHaveBeenCalledWith({ confirmedSubjectCode: 'GZBO-001', note: 'Era la consulta de otro paciente.' })
  })

  it('escribir un motivo y borrarlo: no se manda motivo (ida y vuelta)', () => {
    const { onConfirm } = show({ open: true })
    type(note()!, 'algo')
    type(note()!, '   ')
    click(button('GZBO-001')!)
    expect(onConfirm).toHaveBeenCalledWith({ confirmedSubjectCode: 'GZBO-001' })
  })

  it('cerrar y volver a abrir: el motivo escrito antes no vuelve solo (ida y vuelta)', () => {
    const { rerender, onConfirm } = show({ open: true })
    type(note()!, 'motivo de la primera vez')
    rerender({ open: false })
    rerender({ open: true })
    expect(note()!.value).toBe('')
    click(button('GZBO-001')!)
    expect(onConfirm).toHaveBeenCalledWith({ confirmedSubjectCode: 'GZBO-001' })
  })

  it('mientras se guarda no se puede confirmar dos veces ni cancelar', () => {
    const { onConfirm, onCancel } = show({ open: true, busy: true })
    const confirm = button('GZBO-001')!
    expect(confirm.disabled).toBe(true)
    click(confirm)
    click(button('Cancelar')!)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancelar no manda nada', () => {
    const { onConfirm, onCancel } = show({ open: true })
    click(button('Cancelar')!)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('un rechazo se muestra como alerta dentro del diálogo', () => {
    show({ open: true, feedback: { kind: 'error', text: 'No se declaró nada.' } })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('No se declaró nada.')
  })

  it('lo que pasó se sigue diciendo cuando la evolución ya figura anulada y el diálogo no está', () => {
    show({ voided: true, feedback: { kind: 'done', text: 'Quedó marcada.' } })
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Quedó marcada.')
    expect(buttons()).toHaveLength(0)
  })

  it('un rechazo sobre una evolución que al releer ya figura anulada tampoco se pierde', () => {
    show({ voided: true, feedback: { kind: 'error', text: 'Esta evolución ya figuraba como registrada por error.' } })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('ya figuraba')
  })
})
