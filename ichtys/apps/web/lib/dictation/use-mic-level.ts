'use client'

import { useEffect, useState } from 'react'

/**
 * Nivel del micrófono mientras se graba, de 0 a 1. Sirve para una sola cosa: que
 * quien dicta vea que su voz está entrando. No guarda ni envía nada: lee el flujo
 * que ya abrió la grabación y descarta cada medición al tomar la siguiente.
 */
export function useMicLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!stream) {
      setLevel(0)
      return
    }
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Context) return

    const context = new Context()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    const buffer = new Float32Array(analyser.fftSize)

    let frame = 0
    let last = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      // Diez lecturas por segundo alcanzan y no hacen trabajar de más a la pantalla.
      if (now - last < 100) return
      last = now
      analyser.getFloatTimeDomainData(buffer)
      let energy = 0
      for (const sample of buffer) energy += sample * sample
      setLevel(levelFromRms(Math.sqrt(energy / buffer.length)))
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      source.disconnect()
      void context.close()
    }
  }, [stream])

  return level
}

/** De amplitud RMS a una escala 0–1 que se mueve con una voz normal (curva de raíz, tope en 0,25). */
export function levelFromRms(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0
  return Math.min(1, Math.sqrt(rms / 0.25))
}
