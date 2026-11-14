/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DictatedSegments, type SegmentPlayer } from '../dictated-segments'

/**
 * «Lo dictado, tramo por tramo» (docs/decisions/enlace-frase-audio.md): junto a la grabación,
 * lo que escribió el transcriptor para cada tramo y un botón que reproduce ese pedazo y no otro.
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
  vi.restoreAllMocks()
})

const segments = [
  { startMs: 5000, endMs: 7250, text: 'Paciente de 58 años' },
  { startMs: 65_000, endMs: 68_000, text: 'refiere mareos leves refiere mareos leves refiere mareos leves' },
]
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

function makePlayer(durationSec = 120) {
  const played: Array<{ offsetSec: number; durationSec: number }> = []
  let end: (() => void) | null = null
  const stop = vi.fn()
  const player: SegmentPlayer = {
    decode: vi.fn(async () => ({
      durationSec,
      play: (offsetSec: number, length: number, onEnd: () => void) => {
        played.push({ offsetSec, durationSec: length })
        end = onEnd
        return stop
      },
    })),
  }
  return { player, played, stop, finish: () => act(() => end?.()) }
}

async function show(props: Partial<React.ComponentProps<typeof DictatedSegments>> = {}) {
  const loadSegments = props.loadSegments ?? vi.fn(async () => segments)
  const loadAudio = props.loadAudio ?? vi.fn(async () => new Blob(['x']))
  act(() => {
    root.render(<DictatedSegments loadSegments={loadSegments} loadAudio={loadAudio} {...props} />)
  })
  return { loadSegments, loadAudio }
}
async function open() {
  const details = container.querySelector('details')!
  await act(async () => {
    details.open = true
    details.dispatchEvent(new Event('toggle'))
  })
  await flush()
}
const buttons = () => [...container.querySelectorAll('button')]
const click = async (button: Element) => {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

describe('DictatedSegments', () => {
  it('plegada no pide nada: leer los tramos queda registrado, y no se registra lo que nadie abrió', async () => {
    const { loadSegments } = await show()
    expect(loadSegments).not.toHaveBeenCalled()
    expect(container.querySelector('summary')!.textContent).toBe('Lo dictado, tramo por tramo')
  })

  it('al abrir lista los tramos en orden, con su tiempo, y dice que es el texto del transcriptor sin corregir', async () => {
    const { loadSegments } = await show()
    await open()
    expect(loadSegments).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Texto del transcriptor, sin corregir')
    const rows = [...container.querySelectorAll('li')].map((li) => li.textContent)
    expect(rows[0]).toContain('0:05')
    expect(rows[0]).toContain('Paciente de 58 años')
    expect(rows[1]).toContain('1:05')
  })

  it('cerrar y volver a abrir no los pide de nuevo', async () => {
    const { loadSegments } = await show()
    await open()
    await open()
    expect(loadSegments).toHaveBeenCalledTimes(1)
  })

  it('marca el tramo donde el transcriptor parece haberse repetido', async () => {
    await show()
    await open()
    const rows = [...container.querySelectorAll('li')]
    expect(rows[0]!.textContent).not.toContain('repetición')
    expect(rows[1]!.textContent).toContain('Posible repetición del transcriptor')
  })

  it('si no se pueden cargar lo dice, y deja reintentar', async () => {
    const loadSegments = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(segments)
    await show({ loadSegments })
    await open()
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('No se pudieron cargar los tramos')
    await click(buttons().find((b) => b.textContent === 'Reintentar')!)
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('escuchar un tramo reproduce ese pedazo: desde su comienzo y por su largo', async () => {
    const { player, played } = makePlayer()
    const { loadAudio } = await show({ player })
    await open()
    await click(buttons()[1]!)
    expect(loadAudio).toHaveBeenCalledTimes(1)
    expect(played).toEqual([{ offsetSec: 65, durationSec: 3 }])
  })

  it('la grabación se pide y se decodifica una sola vez aunque se escuchen varios tramos', async () => {
    const { player, played, stop } = makePlayer()
    const { loadAudio } = await show({ player })
    await open()
    await click(buttons()[0]!)
    await click(buttons()[1]!)
    expect(loadAudio).toHaveBeenCalledTimes(1)
    expect(player.decode).toHaveBeenCalledTimes(1)
    expect(played).toHaveLength(2)
    // El primero se corta antes de empezar el segundo: no suenan dos a la vez.
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('mientras suena, el botón de ese tramo dice «Detener» y lo detiene', async () => {
    const { player, stop, finish } = makePlayer()
    await show({ player })
    await open()
    await click(buttons()[0]!)
    expect(buttons()[0]!.textContent).toBe('Detener')
    expect(buttons()[1]!.textContent).toBe('Escuchar')
    await click(buttons()[0]!)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(buttons()[0]!.textContent).toBe('Escuchar')
    await click(buttons()[1]!)
    await finish()
    expect(buttons()[1]!.textContent).toBe('Escuchar')
  })

  it('un tramo que cae fuera de lo decodificado no suena, y se dice', async () => {
    const { player, played } = makePlayer(10)
    await show({ player })
    await open()
    await click(buttons()[1]!)
    expect(played).toEqual([])
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('no se pudo ubicar en la grabación')
  })

  it('si la grabación no se puede cargar o decodificar lo dice, y no queda nada sonando', async () => {
    const { player, played } = makePlayer()
    await show({ player, loadAudio: vi.fn(async () => { throw new Error('x') }) })
    await open()
    await click(buttons()[0]!)
    expect(played).toEqual([])
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('No se pudo reproducir')
    expect(buttons()[0]!.textContent).toBe('Escuchar')
  })

  it('al salir de la pantalla corta lo que suena', async () => {
    const { player, stop } = makePlayer()
    await show({ player })
    await open()
    await click(buttons()[0]!)
    act(() => root.render(<div />))
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
