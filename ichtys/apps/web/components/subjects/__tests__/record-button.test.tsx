/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordButton, recordingClock, type RecordButtonProps } from '../record-button'
import { levelFromRms } from '../../../lib/dictation/use-mic-level'

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

function show(props: Partial<RecordButtonProps> = {}) {
  const handlers = { onStart: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() }
  act(() => {
    root.render(<RecordButton state="idle" seconds={0} level={0} {...handlers} {...props} />)
  })
  const byText = (text: string) => [...container.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes(text)) as HTMLButtonElement | undefined
  return { ...handlers, byText, buttons: [...container.querySelectorAll('button')] as HTMLButtonElement[] }
}

describe('RecordButton', () => {
  it('en reposo: un botón con el dibujo del micrófono, su nombre escrito y un color que existe', () => {
    const { buttons, onStart } = show()
    expect(buttons).toHaveLength(1)
    const button = buttons[0]!
    expect(button.getAttribute('aria-label')).toBe('Grabar el dictado')
    expect(button.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toContain('Grabar')
    // El fondo sale de la paleta real: con una clase inventada el ícono blanco no se ve.
    expect(button.className).toContain('bg-alphi-navy')
    expect(button.className).toContain('text-white')
    act(() => button.click())
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('grabando: tiempo, nivel, y dos botones con nombre: pausar y terminar', () => {
    const { byText, onPause, onStop, onStart } = show({ state: 'recording', seconds: 75, level: 0.6 })
    expect(container.textContent).toContain('Grabando')
    expect(container.querySelector('[role="timer"]')?.textContent).toBe('1:15')
    expect(container.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('3')
    act(() => byText('Pausar')!.click())
    expect(onPause).toHaveBeenCalledTimes(1)
    act(() => byText('Terminar y transcribir')!.click())
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onStart).not.toHaveBeenCalled()
  })

  it('en pausa: lo dice, no muestra nivel y ofrece seguir o terminar', () => {
    const { byText, onResume, onStop } = show({ state: 'paused', seconds: 30, level: 0.9 })
    expect(container.textContent).toContain('En pausa')
    expect(container.querySelector('[role="meter"]')).toBeNull()
    expect(byText('Pausar')).toBeUndefined()
    act(() => byText('Seguir grabando')!.click())
    expect(onResume).toHaveBeenCalledTimes(1)
    act(() => byText('Terminar y transcribir')!.click())
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('si no entra voz lo dice', () => {
    show({ state: 'recording', seconds: 5, level: 0, silent: true })
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/No llega voz al micrófono/)
  })

  it('mientras transcribe no se puede volver a tocar', () => {
    const { buttons, onStart } = show({ state: 'busy' })
    expect(buttons[0]!.disabled).toBe(true)
    expect(buttons[0]!.getAttribute('aria-label')).toBe('Transcribiendo el dictado')
    act(() => buttons[0]!.click())
    expect(onStart).not.toHaveBeenCalled()
  })

  it('el reloj y la escala de nivel', () => {
    expect(recordingClock(0)).toBe('0:00')
    expect(recordingClock(605)).toBe('10:05')
    expect(levelFromRms(0)).toBe(0)
    expect(levelFromRms(Number.NaN)).toBe(0)
    expect(levelFromRms(1)).toBe(1)
    expect(levelFromRms(0.0625)).toBeCloseTo(0.5)
  })
})
