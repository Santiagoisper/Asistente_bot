'use client'

/**
 * Dictado de la evolución (docs/decisions/consulta-dictada.md).
 * Graba o recibe un audio, lo transcribe en este equipo y arma un borrador
 * por bloques. No guarda nada: «Usar como evolución» llena el cuadro de
 * siempre y el médico guarda con el botón de siempre.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildDictationDraft, NOT_MENTIONED, type DictationDraft } from '@ichtys/clinical'
import { prepareAudio } from '../../lib/dictation/audio'
import { DICTATION_MODEL, DICTATION_MODEL_REVISION, type TranscriberEvent } from '../../lib/dictation/protocol'

export interface DictationSource {
  kind: 'dictation'
  durationSec: number
  model: string
  modelRevision: string
  corrections: number
  missingBlocks: number
}

type Phase = 'idle' | 'recording' | 'preparing' | 'model' | 'transcribing' | 'ready' | 'error'

const CONSENT_KEY = 'alphi-dictation-consent'

function readConsent(): boolean {
  try {
    return sessionStorage.getItem(CONSENT_KEY) === 'yes'
  } catch {
    return false
  }
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function DictationPanel({ onUse }: { onUse: (text: string, source: DictationSource) => void }) {
  const [consent, setConsent] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [modelPercent, setModelPercent] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [draft, setDraft] = useState<DictationDraft | null>(null)
  const [text, setText] = useState('')
  const [durationSec, setDurationSec] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setConsent(readConsent())
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
      workerRef.current?.terminate()
    }
  }, [])

  const fail = useCallback((reason: string) => {
    setPhase('error')
    setMessage(reason)
  }, [])

  const transcribe = useCallback(
    async (blob: Blob) => {
      setPhase('preparing')
      setMessage(null)
      setDraft(null)
      let prepared
      try {
        prepared = await prepareAudio(blob)
      } catch {
        fail('No se pudo leer el audio. Probá con otro archivo o grabá de nuevo.')
        return
      }
      if (prepared.samples.length === 0) {
        fail('El audio no tiene voz para transcribir.')
        return
      }
      setDurationSec(prepared.durationSec)
      setPhase('model')
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL('../../lib/dictation/transcriber.worker.ts', import.meta.url), { type: 'module' })
      }
      const worker = workerRef.current
      worker.onmessage = (event: MessageEvent<TranscriberEvent>) => {
        const data = event.data
        if (data.type === 'model-progress') setModelPercent(data.percent)
        else if (data.type === 'transcribing') setPhase('transcribing')
        else if (data.type === 'result') {
          const built = buildDictationDraft(data.text)
          setDraft(built)
          setText(built.text)
          setPhase('ready')
        } else fail('No se pudo transcribir en este equipo. El audio no salió de acá; podés escribir la evolución a mano.')
      }
      worker.onerror = () => fail('No se pudo transcribir en este equipo. El audio no salió de acá; podés escribir la evolución a mano.')
      worker.postMessage({ type: 'transcribe', samples: prepared.samples }, [prepared.samples.buffer])
    },
    [fail],
  )

  async function startRecording() {
    setMessage(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        if (timerRef.current) clearInterval(timerRef.current)
        void transcribe(new Blob(chunks, { type: recorder.mimeType }))
      }
      recorderRef.current = recorder
      recorder.start()
      setSeconds(0)
      setPhase('recording')
      timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000)
    } catch {
      fail('No hay acceso al micrófono. Dale permiso al navegador o subí un audio.')
    }
  }

  function acceptConsent() {
    try {
      sessionStorage.setItem(CONSENT_KEY, 'yes')
    } catch {
      // Sin almacenamiento de sesión: el aviso se vuelve a mostrar la próxima vez.
    }
    setConsent(true)
  }

  function useDraft() {
    if (!draft) return
    const missing = text.split('\n').filter((line) => line.trimEnd().endsWith(NOT_MENTIONED)).length
    onUse(text, {
      kind: 'dictation',
      durationSec,
      model: DICTATION_MODEL,
      modelRevision: DICTATION_MODEL_REVISION,
      corrections: draft.corrections.length,
      missingBlocks: missing,
    })
    setDraft(null)
    setText('')
    setPhase('idle')
  }

  const busy = phase === 'preparing' || phase === 'model' || phase === 'transcribing'
  const missingCount = text.split('\n').filter((line) => line.trimEnd().endsWith(NOT_MENTIONED)).length

  return (
    <section className="space-y-3 rounded-lg border border-alphi-border bg-white p-4" aria-label="Dictar la evolución">
      <h3 className="text-sm font-bold uppercase tracking-wide text-alphi-muted">Dictar la evolución</h3>

      {!consent ? (
        <div className="space-y-2 text-sm">
          <p>
            Se graba <strong>tu dictado</strong> para armar un borrador. El audio se transcribe en este equipo, no se envía a
            ningún servidor y no se guarda. Grabar a un paciente exige su consentimiento.
          </p>
          <button type="button" onClick={acceptConsent} className="rounded border border-alphi-border px-3 py-1.5 text-sm font-semibold">
            Entendido
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {phase === 'recording' ? (
              <button type="button" onClick={() => recorderRef.current?.stop()} className="rounded bg-red-700 px-3 py-1.5 text-sm font-semibold text-white">
                Detener ({clock(seconds)})
              </button>
            ) : (
              <button type="button" onClick={() => void startRecording()} disabled={busy} className="rounded bg-alphi-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                Grabar
              </button>
            )}
            <label className={`cursor-pointer rounded border border-alphi-border px-3 py-1.5 text-sm font-semibold ${busy || phase === 'recording' ? 'pointer-events-none opacity-50' : ''}`}>
              Subir un audio
              <input
                type="file"
                accept="audio/*,video/mp4,video/webm"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void transcribe(file)
                }}
              />
            </label>
            <span className="text-xs text-alphi-muted" role="status">
              {phase === 'preparing' && 'Preparando el audio…'}
              {phase === 'model' && `Cargando el modelo en este equipo (${modelPercent} %). La primera vez tarda.`}
              {phase === 'transcribing' && 'Transcribiendo en este equipo…'}
              {phase === 'recording' && 'Grabando. Nombrá cada bloque al empezarlo: «Motivo», «Signos vitales», «Plan»…'}
            </span>
          </div>
          {message ? <p className="text-sm text-red-700" role="alert">{message}</p> : null}
        </>
      )}

      {phase === 'ready' && draft ? (
        <div className="space-y-3">
          <p role="note" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
            Borrador armado a partir de tu dictado. Revisalo contra lo que dijiste antes de usarlo: no se guardó nada todavía.
          </p>
          {draft.corrections.length > 0 ? (
            <div className="text-xs">
              <p className="font-semibold">Correcciones que dictaste ({draft.corrections.length}). Quedó el segundo valor:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {draft.corrections.map((correction, index) => (
                  <li key={index}>
                    <span className="line-through">{correction.original}</span> → <strong>{correction.corrected}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {missingCount > 0 ? (
            <p className="text-xs font-semibold text-amber-900">
              {missingCount} {missingCount === 1 ? 'bloque figura' : 'bloques figuran'} como «{NOT_MENTIONED}». Completalos o dejalos así a sabiendas.
            </p>
          ) : null}
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={Math.min(18, Math.max(8, text.split('\n').length + 1))}
            aria-label="Borrador de la evolución dictada"
            className="w-full rounded border border-alphi-border px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={useDraft} disabled={!text.trim()} className="rounded bg-alphi-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              Usar como evolución
            </button>
            <button type="button" onClick={() => { setDraft(null); setText(''); setPhase('idle') }} className="rounded border border-alphi-border px-3 py-1.5 text-sm font-semibold">
              Descartar el borrador
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
