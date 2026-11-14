'use client'

import { useEffect, useRef, useState } from 'react'
import { recordingClock } from '../subjects/record-button'

/** Una grabación sin sujeto tal como la devuelve `/api/dictation-audios/unassigned`. Sin contenido. */
export interface UnassignedAudioItem {
  id: string
  studyName?: string
  take: number
  durationSec: number
  recordedAt: string
  withdrawnAt: string
  expiresAt: string
  available: boolean
}

const day = (iso: string) => new Date(iso).toLocaleDateString('es-AR')

/**
 * Una grabación de la lista. No se descarga sola: se pide cuando la persona toca «Escuchar», y
 * cada pedido queda registrado, igual que la grabación de una evolución.
 */
function UnassignedAudioRow({ audio }: { audio: UnassignedAudioItem }) {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'expired'>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  async function listen() {
    setState('loading')
    setProblem(null)
    try {
      const res = await fetch(`/api/dictation-audios/unassigned/${audio.id}`)
      if (res.status === 410) {
        setState('expired')
        return
      }
      if (res.status === 403 || res.status === 404) {
        setProblem('No se puede escuchar: ya no tenés acceso a ese estudio, o la grabación ya no está.')
        setState('idle')
        return
      }
      if (res.status === 429) {
        setProblem('Demasiados pedidos seguidos. Esperá un momento y volvé a intentar.')
        setState('idle')
        return
      }
      if (!res.ok) throw new Error('audio_failed')
      const objectUrl = URL.createObjectURL(await res.blob())
      urlRef.current = objectUrl
      setUrl(objectUrl)
      setState('idle')
    } catch {
      setProblem('No se pudo cargar la grabación.')
      setState('idle')
    }
  }

  const gone = !audio.available || state === 'expired'
  return (
    <li className="rounded-lg border border-alphi-border bg-white p-3 text-sm text-alphi-navy">
      <p className="font-semibold">
        Grabación del {day(audio.recordedAt)} · toma {audio.take} · {recordingClock(audio.durationSec)}
        {audio.studyName ? ` · ${audio.studyName}` : ''}
      </p>
      {gone ? (
        <p className="mt-1 text-xs text-alphi-muted">
          Se retiró del sujeto el {day(audio.withdrawnAt)} y se borró al vencer el plazo de conservación ({day(audio.expiresAt)}).
        </p>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-alphi-muted">
          <span>
            Se retiró del sujeto el {day(audio.withdrawnAt)} · se borra el {day(audio.expiresAt)}
          </span>
          {url ? (
            <audio controls src={url} className="h-8 max-w-full" />
          ) : (
            <button type="button" onClick={() => void listen()} disabled={state === 'loading'} className="rounded border border-alphi-border px-2 py-1 font-semibold text-alphi-navy disabled:opacity-50">
              {state === 'loading' ? 'Cargando…' : 'Escuchar'}
            </button>
          )}
          {problem ? (
            <span role="alert" className="text-alphi-rose">
              {problem}
            </span>
          ) : null}
        </div>
      )}
    </li>
  )
}

/**
 * «Grabaciones sin sujeto» (docs/decisions/grabacion-en-sujeto-equivocado.md, D24, punto 3).
 * Por ahora cada persona ve las que grabó.
 *
 * - `inicio`: aparece solo si hay alguna. Si la lista no se pudo leer no dice nada: no afirma
 *   que no hay, y la página propia sí avisa.
 * - `page`: dice también cuando no hay ninguna y cuando no se pudo leer.
 */
export function UnassignedAudiosPanel({ variant }: { variant: 'inicio' | 'page' }) {
  const [audios, setAudios] = useState<UnassignedAudioItem[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/dictation-audios/unassigned')
        if (!res.ok) throw new Error('list_failed')
        const data = (await res.json()) as { audios?: UnassignedAudioItem[] }
        if (alive) setAudios(Array.isArray(data.audios) ? data.audios : [])
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (failed) {
    if (variant === 'inicio') return null
    return (
      <p role="alert" className="rounded-lg border border-alphi-rose/30 bg-alphi-rose/10 px-3 py-2 text-sm text-alphi-rose">
        No se pudieron cargar las grabaciones sin sujeto. Recargá la página.
      </p>
    )
  }
  if (audios === null) return variant === 'inicio' ? null : <p className="text-sm text-alphi-muted">Cargando…</p>
  if (audios.length === 0) {
    return variant === 'inicio' ? null : <p className="text-sm text-alphi-muted">No tenés grabaciones sin sujeto.</p>
  }

  return (
    <section id="grabaciones-sin-sujeto" className="space-y-3 rounded-2xl border border-alphi-border bg-white p-5">
      <div>
        {/* En su página el título ya está arriba. */}
        {variant === 'inicio' ? <h2 className="text-sm font-bold uppercase tracking-wide text-alphi-muted">Grabaciones sin sujeto</h2> : null}
        {variant === 'inicio' ? (
          <p className="mt-1 text-sm text-alphi-navy">
            Son grabaciones que hiciste y que se retiraron de un sujeto porque la evolución se registró ahí por error. Se borran el mismo día en que se
            iban a borrar.{' '}
            <a href="/grabaciones-sin-sujeto" className="font-semibold underline underline-offset-2">
              Qué son y qué hacer con ellas
            </a>
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-alphi-navy">
              Son grabaciones que hiciste y que se retiraron de un sujeto porque la evolución se registró ahí por error. Siguen siendo datos clínicos:
              están cifradas, cada escucha queda registrada y se borran el mismo día en que se iban a borrar. Alphi no las pasa a otro sujeto: la
              evolución se escribe o se dicta de nuevo en el sujeto que corresponde.
            </p>
            <p className="mt-1 text-xs text-alphi-muted">Por ahora las ve y las escucha solo quien las grabó.</p>
          </>
        )}
      </div>
      <ul className="space-y-2">
        {audios.map((audio) => (
          <UnassignedAudioRow key={audio.id} audio={audio} />
        ))}
      </ul>
    </section>
  )
}
