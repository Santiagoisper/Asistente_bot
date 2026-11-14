/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordingNotice, type RecordingNoticeProps } from '../recording-notice'

/**
 * D23: antes de grabar o de subir un audio, la persona confirma en qué sujeto va a quedar.
 * Una grabación guardada en el sujeto equivocado deja también la evolución en el sujeto
 * equivocado: el aviso nombra al sujeto y el botón que sigue lo repite.
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

function show(props: Partial<RecordingNoticeProps> = {}) {
  const handlers = { onAccept: vi.fn(), onCancel: vi.fn() }
  act(() => {
    root.render(<RecordingNotice subjectCode="ENSAYO-008" retentionDays={30} action="record" {...handlers} {...props} />)
  })
  const buttons = [...container.querySelectorAll('button')] as HTMLButtonElement[]
  return { ...handlers, buttons, text: container.textContent ?? '' }
}

describe('RecordingNotice', () => {
  it('nombra al sujeto en el texto y en el botón que empieza a grabar', () => {
    const { text, buttons, onAccept } = show()
    expect(text).toContain('Vas a grabar en el sujeto ENSAYO-008')
    const accept = buttons[0]!
    expect(accept.textContent).toBe('Es ENSAYO-008, empezar a grabar')
    act(() => accept.click())
    expect(onAccept).toHaveBeenCalledTimes(1)
  })

  it('dice qué pasa con la grabación y recuerda el consentimiento del paciente', () => {
    const { text } = show({ retentionDays: 30 })
    expect(text).toContain('durante 30 días')
    expect(text).toContain('Grabar a un paciente exige su consentimiento')
  })

  it('al subir un audio, el texto y el botón hablan del audio que se va a elegir', () => {
    const { text, buttons } = show({ action: 'upload' })
    expect(text).toContain('El audio que subas va a quedar en el sujeto ENSAYO-008')
    expect(buttons[0]!.textContent).toBe('Es ENSAYO-008, elegir el audio')
  })

  it('«No es este sujeto» no graba nada', () => {
    const { buttons, onAccept, onCancel } = show()
    const cancel = buttons.find((button) => button.textContent === 'No es este sujeto')!
    act(() => cancel.click())
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onAccept).not.toHaveBeenCalled()
  })

  it.each(['…', '', '   '])('sin el código del sujeto a la vista (%j) no deja seguir', (subjectCode) => {
    const { buttons, onAccept, text } = show({ subjectCode })
    const accept = buttons[0]!
    expect(accept.disabled).toBe(true)
    act(() => accept.click())
    expect(onAccept).not.toHaveBeenCalled()
    expect(text).toContain('Esperá a que cargue el sujeto')
  })
})
