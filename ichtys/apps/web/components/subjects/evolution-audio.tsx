'use client'

/**
 * La grabación de una evolución dictada, junto a su texto
 * (docs/decisions/consulta-dictada.md, D14). No se descarga sola: se pide
 * cuando alguien toca «Escuchar», y cada pedido queda registrado.
 */
import { useEffect, useRef, useState } from 'react'
import type { DictatedSegment } from '@ichtys/clinical'
import { audioLabel, evolutionTakesNotice } from '../../lib/dictation/takes'
import { DictatedSegments } from './dictated-segments'
import { recordingClock } from './record-button'

export interface EvolutionAudioInfo {
  evolutionId: string
  /** Número de toma dentro de la evolución, desde 1 (D22). */
  take: number
  durationSec: number
  expiresAt: string
  available: boolean
  /** Se retiró de este sujeto y pasó a las grabaciones sin sujeto (D24). No es una vencida. */
  withdrawn?: boolean
  /** Tiene guardados los tramos de lo dictado (docs/decisions/enlace-frase-audio.md). */
  hasSegments?: boolean
}

export function EvolutionAudio({ studyId, subjectId, audio, several = false }: { studyId: string; subjectId: string; audio: EvolutionAudioInfo; several?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'expired' | 'unplayable'>('idle')
  const urlRef = useRef<string | null>(null)
  /** La grabación ya pedida: escuchar un tramo no la pide (ni la registra) otra vez. */
  const blobRef = useRef<Blob | null>(null)
  const base = `/api/studies/${studyId}/subjects/${subjectId}/evolutions/${audio.evolutionId}/audio`

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  /** `null`: venció o se retiró mientras la pantalla estaba abierta. */
  async function fetchRecording(): Promise<Blob | null> {
    if (blobRef.current) return blobRef.current
    const res = await fetch(`${base}?take=${audio.take}`)
    if (res.status === 410) return null
    if (!res.ok) throw new Error('audio_failed')
    blobRef.current = await res.blob()
    return blobRef.current
  }

  async function loadSegments(): Promise<DictatedSegment[]> {
    const res = await fetch(`${base}/segments?take=${audio.take}`)
    if (res.status === 410) setState('expired')
    if (!res.ok) throw new Error('segments_failed')
    return ((await res.json()) as { segments: DictatedSegment[] }).segments
  }

  async function loadAudioForSegment(): Promise<Blob> {
    const blob = await fetchRecording()
    if (!blob) {
      setState('expired')
      throw new Error('audio_expired')
    }
    return blob
  }

  async function listen() {
    setState('loading')
    try {
      const blob = await fetchRecording()
      if (!blob) {
        setState('expired')
        return
      }
      const objectUrl = URL.createObjectURL(blob)
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
  if (audio.withdrawn) {
    return (
      <p className="mt-3 border-t border-alphi-border pt-2 text-xs text-alphi-muted">
        {label}. La grabación ({recordingClock(audio.durationSec)}) se retiró de este sujeto y pasó a las grabaciones sin sujeto. Quien la grabó y
        quien coordina el estudio la encuentran en{' '}
        <a href="/grabaciones-sin-sujeto" className="font-semibold text-alphi-navy underline underline-offset-2">
          Grabaciones sin sujeto
        </a>
        .
      </p>
    )
  }
  if (!audio.available || state === 'expired') {
    return <p className="mt-3 border-t border-alphi-border pt-2 text-xs text-alphi-muted">{label}. La grabación ({recordingClock(audio.durationSec)}) se borró al vencer el plazo de conservación ({expires}).</p>
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-alphi-border pt-2 text-xs text-alphi-muted">
      <span>
        {label} · grabación de {recordingClock(audio.durationSec)} · se borra el {expires}
      </span>
      {url ? (
        // La grabación puede venir de otro equipo, en un formato que este no reproduce (D25).
        <audio controls src={url} onError={() => setState('unplayable')} className="h-8 max-w-full" />
      ) : (
        <button type="button" onClick={() => void listen()} disabled={state === 'loading'} className="rounded border border-alphi-border px-2 py-1 font-semibold text-alphi-navy disabled:opacity-50">
          {state === 'loading' ? 'Cargando…' : 'Escuchar'}
        </button>
      )}
      {state === 'error' ? <span role="alert" className="text-red-700">No se pudo cargar la grabación.</span> : null}
      {state === 'unplayable' ? (
        <span role="alert" className="text-red-700">Este equipo no puede reproducir esta grabación. Probá en otro navegador o en otro equipo: la grabación está guardada.</span>
      ) : null}
      {audio.hasSegments ? <DictatedSegments loadSegments={loadSegments} loadAudio={loadAudioForSegment} /> : null}
    </div>
  )
}

/**
 * Las grabaciones de una evolución, una por toma, y el aviso si de alguna toma no quedó grabación
 * (D22). Con `dictationTakes` el aviso alcanza a la última toma y al caso en que no quedó ninguna.
 */
export function EvolutionAudios({
  studyId,
  subjectId,
  audios,
  dictationTakes = null,
  settled = true,
  listingKnown = true,
}: {
  studyId: string
  subjectId: string
  audios: EvolutionAudioInfo[]
  /** Cuántas tomas tuvo el dictado. Vacío: no se dictó, o la evolución es anterior a ese dato. */
  dictationTakes?: number | null
  /** Ya no puede haber una grabación de esta evolución subiendo. */
  settled?: boolean
  /** El listado de grabaciones se pudo leer. */
  listingKnown?: boolean
}) {
  const notice = evolutionTakesNotice({ stored: audios.map((audio) => audio.take), total: dictationTakes, settled, listingKnown })
  if (audios.length === 0 && !notice) return null
  return (
    <>
      {audios.map((audio) => (
        <EvolutionAudio key={audio.take} studyId={studyId} subjectId={subjectId} audio={audio} several={audios.length > 1} />
      ))}
      {notice ? <p className={audios.length === 0 ? 'mt-3 border-t border-alphi-border pt-2 text-xs text-alphi-muted' : 'mt-2 text-xs text-alphi-muted'}>{notice}</p> : null}
    </>
  )
}
