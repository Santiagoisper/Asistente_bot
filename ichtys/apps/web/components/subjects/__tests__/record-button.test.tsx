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
  const onStart = vi.fn()
  const onStop = vi.fn()
  act(() => {
    root.render(<RecordButton state="idle" seconds={0} level={0} onStart={onStart} onStop={onStop} {...props} />)
  })
  return { onStart, onStop, button: container.querySelector('button') as HTMLButtonElement }
}

describe('RecordButton', () => {
  it('en reposo invita a grabar y un toque prende la grabadora', () => {
    const { button, onStart, onStop } = show()
    expect(button.getAttribute('aria-label')).toBe('Grabar el dictado')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    act(() => button.click())
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onStop).not.toHaveBeenCalled()
  })

  it('grabando muestra el tiempo y el nivel, y el mismo botón la apaga', () => {
    const { button, onStart, onStop } = show({ state: 'recording', seconds: 75, level: 0.6 })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('Detener la grabación (1:15)')
    expect(container.querySelector('[role="timer"]')?.textContent).toBe('1:15')
    expect(container.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('3')
    act(() => button.click())
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onStart).not.toHaveBeenCalled()
  })

  it('si no entra voz lo dice junto al botón', () => {
    show({ state: 'recording', seconds: 5, level: 0, silent: true })
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/No llega voz al micrófono/)
  })

  it('mientras transcribe no se puede volver a tocar', () => {
    const { button, onStart } = show({ state: 'busy' })
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-label')).toBe('Transcribiendo el dictado')
    act(() => button.click())
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
