'use client'

/**
 * «Lo dictado, tramo por tramo» (docs/decisions/enlace-frase-audio.md). Junto a la grabación
 * de una toma, lo que el transcriptor escribió para cada cosa dicha entre dos pausas, con un
 * botón que reproduce ese pedazo. Es para comprobar si el transcriptor oyó bien: no es la
 * evolución, y se dice.
 *
 * Plegada no pide nada: leer los tramos queda registrado. Reproducir un tramo pide la
 * grabación (una vez), que también queda registrada.
 */
import { useEffect, useRef, useState } from 'react'
import { collapseRepetitions, segmentClock, segmentPlayback, type DictatedSegment } from '@ichtys/clinical'

/** Una grabación decodificada, lista para reproducir pedazos. `play` devuelve cómo cortarlo. */
export interface DecodedAudio {
  durationSec: number
  play: (offsetSec: number, durationSec: number, onEnd: () => void) => () => void
}

export interface SegmentPlayer {
  decode: (blob: Blob) => Promise<DecodedAudio>
}

/**
 * No se mueve un reproductor: los archivos del grabador del navegador salen sin índice y saltar
 * a un punto no es confiable. Se decodifica la toma y se reproduce ese pedazo de las muestras.
 */
const browserPlayer: SegmentPlayer = {
  async decode(blob) {
    const context = new AudioContext()
    const buffer = await context.decodeAudioData(await blob.arrayBuffer())
    return {
      durationSec: buffer.duration,
      play(offsetSec, durationSec, onEnd) {
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        let stopped = false
        source.onended = () => {
          if (!stopped) onEnd()
        }
        void context.resume()
        source.start(0, offsetSec, durationSec)
        return () => {
          stopped = true
          try {
            source.stop()
          } catch {
            // Ya había terminado.
          }
        }
      },
    }
  },
}

export function DictatedSegments({
  loadSegments,
  loadAudio,
  player = browserPlayer,
}: {
  /** Pide los tramos al servidor. Queda registrado. */
  loadSegments: () => Promise<DictatedSegment[]>
  /** La grabación de la toma. Si ya se cargó para escucharla entera, se reusa. */
  loadAudio: () => Promise<Blob>
  player?: SegmentPlayer
}) {
  const [segments, setSegments] = useState<DictatedSegment[] | null>(null)
  const [listState, setListState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [playing, setPlaying] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const decodedRef = useRef<DecodedAudio | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  /** Ya se pidieron: el navegador puede avisar dos veces que se abrió. */
  const requestedRef = useRef(false)

  const stopCurrent = () => {
    stopRef.current?.()
    stopRef.current = null
  }
  useEffect(() => stopCurrent, [])

  async function load() {
    requestedRef.current = true
    setListState('loading')
    try {
      setSegments(await loadSegments())
      setListState('idle')
    } catch {
      setListState('error')
    }
  }

  async function toggle(index: number, segment: DictatedSegment) {
    setPlayError(null)
    stopCurrent()
    if (playing === index) {
      setPlaying(null)
      return
    }
    setPlaying(null)
    setBusy(index)
    try {
      decodedRef.current ??= await player.decode(await loadAudio())
      const decoded = decodedRef.current
      const where = segmentPlayback(segment, decoded.durationSec)
      if (!where) {
        setPlayError('Ese tramo no se pudo ubicar en la grabación. Escuchá la grabación entera.')
        return
      }
      stopRef.current = decoded.play(where.offsetSec, where.durationSec, () => {
        stopRef.current = null
        setPlaying((current) => (current === index ? null : current))
      })
      setPlaying(index)
    } catch {
      setPlayError('No se pudo reproducir ese tramo. Probá con la grabación entera.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <details
      className="mt-2 w-full text-xs text-alphi-muted"
      onToggle={(event) => {
        if (event.currentTarget.open && !requestedRef.current) void load()
      }}
    >
      <summary className="cursor-pointer font-semibold text-alphi-navy">Lo dictado, tramo por tramo</summary>
      <p className="mt-2">Texto del transcriptor, sin corregir. Puede no coincidir con la evolución: sirve para escuchar un pedazo y comprobar si se oyó bien.</p>
      {listState === 'loading' ? <p className="mt-2">Cargando los tramos…</p> : null}
      {listState === 'error' ? (
        <p role="alert" className="mt-2 text-red-700">
          No se pudieron cargar los tramos.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline underline-offset-2">
            Reintentar
          </button>
        </p>
      ) : null}
      {segments ? (
        <ol className="mt-2 space-y-1.5">
          {segments.map((segment, index) => {
            const repeated = collapseRepetitions(segment.text).repetitions.length > 0
            return (
              <li key={segment.startMs} className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => void toggle(index, segment)}
                  disabled={busy !== null}
                  aria-label={`${playing === index ? 'Detener' : 'Escuchar'} el tramo del minuto ${segmentClock(segment.startMs)}`}
                  className="shrink-0 rounded border border-alphi-border px-2 py-0.5 font-semibold text-alphi-navy disabled:opacity-50"
                >
                  {busy === index ? 'Cargando…' : playing === index ? 'Detener' : 'Escuchar'}
                </button>
                <span className="shrink-0 tabular-nums">{segmentClock(segment.startMs)}</span>
                <span className="text-alphi-navy">
                  {segment.text}
                  {repeated ? <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-900">Posible repetición del transcriptor</span> : null}
                </span>
              </li>
            )
          })}
        </ol>
      ) : null}
      {playError ? (
        <p role="alert" className="mt-2 text-red-700">
          {playError}
        </p>
      ) : null}
    </details>
  )
}
