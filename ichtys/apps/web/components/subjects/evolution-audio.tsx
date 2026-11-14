'use client'

/**
 * La grabación de una evolución dictada, junto a su texto
 * (docs/decisions/consulta-dictada.md, D14). No se descarga sola: se pide
 * cuando alguien toca «Escuchar», y cada pedido queda registrado.
 */
import { useEffect, useRef, useState } from 'react'
import { audioLabel, missingTakes, missingTakesNotice } from '../../lib/dictation/takes'
import { recordingClock } from './record-button'

export interface EvolutionAudioInfo {
  evolutionId: string
  /** Número de toma dentro de la evolución, desde 1 (D22). */
  take: number
  durationSec: number
  expiresAt: string
  available: boolean
}

export function EvolutionAudio({ studyId, subjectId, audio, several = false }: { studyId: string; subjectId: string; audio: EvolutionAudioInfo; several?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'expired'>('idle')
  const urlRef = useRef<string | null>(null)

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  async function listen() {
    setState('loading')
    try {
      const res = await fetch(`/api/studies/${studyId}/subjects/${subjectId}/evolutions/${audio.evolutionId}/audio?take=${audio.take}`)
      if (res.status === 410) {
        setState('expired')
        return
      }
      if (!res.ok) throw new Error('audio_failed')
      const objectUrl = URL.createObjectURL(await res.blob())
      urlRef.current = objectUrl
      setUrl(objectUrl)
      setState('idle')
    } catch {
      setState('error')
    }
  }

  const expires = new Date(audio.expiresAt).toLocaleDateString('es-AR')
  // El número es el de la toma dictada (D22): «toma 3» es la tercera parte del texto.
  const label = audioLabel({ take: audio.take, several })
  if (!audio.available || state === 'expired') {
    return <p className="mt-3 border-t border-alphi-border pt-2 text-xs text-alphi-muted">{label}. La grabación ({recordingClock(audio.durationSec)}) se borró al vencer el plazo de conservación ({expires}).</p>
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-alphi-border pt-2 text-xs text-alphi-muted">
      <span>
        {label} · grabación de {recordingClock(audio.durationSec)} · se borra el {expires}
      </span>
      {url ? (
        <audio controls src={url} className="h-8 max-w-full" />
      ) : (
        <button type="button" onClick={() => void listen()} disabled={state === 'loading'} className="rounded border border-alphi-border px-2 py-1 font-semibold text-alphi-navy disabled:opacity-50">
          {state === 'loading' ? 'Cargando…' : 'Escuchar'}
        </button>
      )}
      {state === 'error' ? <span role="alert" className="text-red-700">No se pudo cargar la grabación.</span> : null}
    </div>
  )
}

/** Las grabaciones de una evolución, una por toma, y el aviso si de alguna toma no quedó grabación (D22). */
export function EvolutionAudios({ studyId, subjectId, audios }: { studyId: string; subjectId: string; audios: EvolutionAudioInfo[] }) {
  if (audios.length === 0) return null
  const gaps = missingTakesNotice(missingTakes(audios.map((audio) => audio.take)))
  return (
    <>
      {audios.map((audio) => (
        <EvolutionAudio key={audio.take} studyId={studyId} subjectId={subjectId} audio={audio} several={audios.length > 1} />
      ))}
      {gaps ? <p className="mt-2 text-xs text-alphi-muted">{gaps}</p> : null}
    </>
  )
}
