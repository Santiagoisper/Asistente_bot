/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EvolutionAudios, type EvolutionAudioInfo } from '../evolution-audio'

/**
 * D22: junto a una evolución dictada se lee de qué tomas no quedó grabación. Con la cantidad
 * de tomas guardada, el aviso alcanza a la última toma y al caso en que no quedó ninguna, que
 * antes pasaban sin decirse.
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

const audio = (take: number): EvolutionAudioInfo => ({ evolutionId: 'evo-1', take, durationSec: 30, expiresAt: '2026-12-14T12:00:00.000Z', available: true })

function show(props: Partial<React.ComponentProps<typeof EvolutionAudios>>) {
  act(() => {
    root.render(<EvolutionAudios studyId="s" subjectId="u" audios={[]} {...props} />)
  })
  return container.textContent ?? ''
}

describe('EvolutionAudios — de qué tomas no quedó grabación', () => {
  it('una evolución escrita a mano no muestra nada', () => {
    expect(show({ audios: [], dictationTakes: null })).toBe('')
  })

  it('dictada en una toma y sin grabación: lo dice, aunque no haya ningún reproductor', () => {
    expect(show({ audios: [], dictationTakes: 1 })).toBe('Esta evolución se dictó y no quedó grabación guardada: quedó solo el texto.')
  })

  it('falta la última toma: se lee debajo de los reproductores', () => {
    const text = show({ audios: [audio(1), audio(2)], dictationTakes: 3 })
    expect(text).toContain('Dictada · toma 1')
    expect(text).toContain('Dictada · toma 2')
    expect(text).toContain('De la toma 3 no hay grabación guardada: quedó solo el texto.')
  })

  it('con todas las tomas guardadas no hay aviso', () => {
    const text = show({ audios: [audio(1), audio(2)], dictationTakes: 2 })
    expect(text).not.toContain('no hay grabación')
    expect(text).not.toContain('no quedó')
  })

  it('recién guardada por otra persona: no afirma que falte una grabación que puede estar subiendo', () => {
    expect(show({ audios: [], dictationTakes: 2, settled: false })).toBe('')
    expect(show({ audios: [audio(1)], dictationTakes: 2, settled: false })).not.toContain('no hay grabación')
  })

  it('si el listado de grabaciones no se pudo leer, no afirma nada', () => {
    expect(show({ audios: [], dictationTakes: 2, listingKnown: false })).toBe('')
  })
})
