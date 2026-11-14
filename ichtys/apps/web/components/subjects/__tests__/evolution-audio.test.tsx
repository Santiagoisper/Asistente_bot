/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EvolutionAudio } from '../evolution-audio'

/**
 * D25: una grabación se escucha en un equipo que puede no ser el que la grabó. Si ese equipo
 * no sabe reproducir el formato, la pantalla lo dice en vez de dejar un reproductor mudo.
 */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['x'], { type: 'audio/webm' }), { status: 200 })))
  URL.createObjectURL = vi.fn(() => 'blob:prueba')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const audio = { evolutionId: 'evo-1', take: 1, durationSec: 42, expiresAt: '2026-12-14T00:00:00.000Z', available: true }

async function listen() {
  act(() => {
    root.render(<EvolutionAudio studyId="s1" subjectId="sub1" audio={audio} />)
  })
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Escuchar')!
  await act(async () => {
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return container.querySelector('audio')!
}

describe('EvolutionAudio — escuchar la grabación en este equipo', () => {
  it('con la grabación cargada muestra el reproductor y ningún aviso', async () => {
    const player = await listen()
    expect(player).not.toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('si este equipo no puede reproducirla, lo dice y dice qué hacer', async () => {
    const player = await listen()
    act(() => {
      player.dispatchEvent(new Event('error'))
    })
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe('Este equipo no puede reproducir esta grabación. Probá en otro navegador o en otro equipo: la grabación está guardada.')
  })
})
