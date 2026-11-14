/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProfileUnreadableNotice } from '../profile-unreadable-notice'

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

describe('aviso de perfil ilegible en la ficha del sujeto', () => {
  it('se anuncia como alerta y dice qué pasa, qué no pasó y a quién avisar', () => {
    act(() => root.render(<ProfileUnreadableNotice />))
    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    const text = alert?.textContent ?? ''
    expect(text).toContain('El perfil guardado de este sujeto no se pudo leer')
    expect(text).toContain('no están borrados')
    expect(text).toContain('No se evaluó la elegibilidad')
    expect(text).toContain('Avisá a quien administra la plataforma')
  })
})
