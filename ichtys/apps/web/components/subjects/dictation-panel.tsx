'use client'

/**
 * Dictado de la evolución (docs/decisions/consulta-dictada.md).
 * Graba o recibe un audio, lo transcribe en este equipo y arma un borrador.
 * Este panel no guarda nada: «Usar como evolución» llena el cuadro de siempre
 * y le pasa la grabación a la pantalla, que la sube recién cuando el médico
 * guarda la evolución con el botón de siempre (D14).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildDictationDraft, DICTATION_BLOCKS, NOT_MENTIONED, type DictationDraft } from '@ichtys/clinical'
import { prepareAudio } from '../../lib/dictation/audio'
import {
  DICTATION_AUDIO_MAX_BYTES,
  DICTATION_AUDIO_RETENTION_DAYS,
  DICTATION_MODEL,
  DICTATION_MODEL_REVISION,
  DICTATION_RECORDING_BITS_PER_SECOND,
  type TranscriberEvent,
} from '../../lib/dictation/protocol'
import { useMicLevel } from '../../lib/dictation/use-mic-level'
import { DictationGuide } from './dictation-guide'
import { RecordButton } from './record-button'

export interface DictationSource {
  kind: 'dictation'
  durationSec: number
  model: string
  modelRevision: string
  corrections: number
  missingBlocks: number
  /** Cómo quedó armado el borrador: por apartados nombrados o en texto corrido. */
  layout: 'blocks' | 'narrative'
  /** Frases que el transcriptor repitió en bucle y se dejaron una sola vez. */
  repetitions: number
}

/** Tope de una grabación: pasado esto se detiene sola y se transcribe lo grabado. */
const MAX_RECORDING_SEC = 20 * 60
/** Segundos sin voz al empezar para avisar que el micrófono no está tomando nada. */
const SILENCE_WARNING_SEC = 4
const SILENCE_LEVEL = 0.06

type Phase = 'idle' | 'recording' | 'preparing' | 'model' | 'transcribing' | 'ready' | 'error'

const CONSENT_KEY = 'alphi-dictation-consent'

function readConsent(): boolean {
  try {
    return sessionStorage.getItem(CONSENT_KEY) === 'yes'
  } catch {
    return false
  }
}

/** La grabación de la que salió el borrador. Se sube recién cuando la persona guarda la evolución. */
export interface DictationRecording {
  blob: Blob
  durationSec: number
}

export function DictationPanel({
  onUse,
}: {
  onUse: (text: string, source: DictationSource, recording: DictationRecording | null) => void
}) {
  const [recording, setRecording] = useState<Blob | null>(null)
  const [consent, setConsent] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [modelPercent, setModelPercent] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [draft, setDraft] = useState<DictationDraft | null>(null)
  const [text, setText] = useState('')
  const [durationSec, setDurationSec] = useState(0)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [heardVoice, setHeardVoice] = useState(false)
  const level = useMicLevel(phase === 'recording' ? stream : null)
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

  // Avisar si pasan unos segundos y todavía no entró voz; tope de duración.
  useEffect(() => {
    if (phase === 'recording' && level > SILENCE_LEVEL) setHeardVoice(true)
  }, [phase, level])
  useEffect(() => {
    if (phase === 'recording' && seconds >= MAX_RECORDING_SEC) recorderRef.current?.stop()
  }, [phase, seconds])

  const fail = useCallback((reason: string) => {
    setPhase('error')
    setMessage(reason)
  }, [])

  const transcribe = useCallback(
    async (blob: Blob) => {
      setPhase('preparing')
      setMessage(null)
      setDraft(null)
      setRecording(blob)
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      const recorder = new MediaRecorder(stream, { audioBitsPerSecond: DICTATION_RECORDING_BITS_PER_SECOND })
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        setStream(null)
        if (timerRef.current) clearInterval(timerRef.current)
        void transcribe(new Blob(chunks, { type: recorder.mimeType }))
      }
      recorderRef.current = recorder
      recorder.start()
      setStream(stream)
      setHeardVoice(false)
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
    const missing =
      draft.layout === 'narrative'
        ? draft.missing.length
        : text.split('\n').filter((line) => line.trimEnd().endsWith(NOT_MENTIONED)).length
    onUse(text, {
      kind: 'dictation',
      durationSec,
      model: DICTATION_MODEL,
      modelRevision: DICTATION_MODEL_REVISION,
      corrections: draft.corrections.length,
      missingBlocks: missing,
      layout: draft.layout,
      repetitions: draft.repetitions.length,
    }, recording && recording.size <= DICTATION_AUDIO_MAX_BYTES ? { blob: recording, durationSec } : null)
    setRecording(null)
    setDraft(null)
    setText('')
    setPhase('idle')
  }

  const busy = phase === 'preparing' || phase === 'model' || phase === 'transcribing'
  const missingCount = text.split('\n').filter((line) => line.trimEnd().endsWith(NOT_MENTIONED)).length
  const titleOf = (id: string): string => DICTATION_BLOCKS.find((block) => block.id === id)?.title ?? id
  /** Primer toque sin haber leído el aviso: se muestra el aviso y el mismo botón de aceptar empieza a grabar. */
  const [askingConsent, setAskingConsent] = useState(false)

  return (
    <section className="space-y-3 rounded-lg border border-alphi-border bg-white p-4" aria-label="Dictar la evolución">
      <h3 className="text-sm font-bold uppercase tracking-wide text-alphi-muted">Dictar la evolución</h3>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">

      <div className="flex flex-wrap items-center justify-between gap-4">
        <RecordButton
          state={phase === 'recording' ? 'recording' : busy ? 'busy' : 'idle'}
          seconds={seconds}
          level={level}
          silent={phase === 'recording' && !heardVoice && seconds >= SILENCE_WARNING_SEC}
          onStart={() => {
            if (!consent) setAskingConsent(true)
            else void startRecording()
          }}
          onStop={() => recorderRef.current?.stop()}
        />
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
      </div>

      {askingConsent && !consent ? (
        <div className="space-y-2 rounded border border-alphi-border bg-slate-50 p-3 text-sm" role="group" aria-label="Antes de grabar">
          <p>
            Se graba <strong>tu dictado</strong> para armar un borrador. El audio se transcribe en este equipo. Si guardás la
            evolución, la grabación se guarda cifrada junto a ella durante {DICTATION_AUDIO_RETENTION_DAYS} días y después se
            borra; si descartás el borrador, no se guarda nada. Grabar a un paciente exige su consentimiento.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                acceptConsent()
                setAskingConsent(false)
                void startRecording()
              }}
              className="rounded bg-alphi-ink px-3 py-1.5 text-sm font-semibold text-white"
            >
              Entendido, empezar a grabar
            </button>
            <button type="button" onClick={() => setAskingConsent(false)} className="rounded border border-alphi-border px-3 py-1.5 text-sm font-semibold">
              Ahora no
            </button>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-alphi-muted" role="status">
        {phase === 'preparing' && 'Preparando el audio…'}
        {phase === 'model' && `Cargando el modelo en este equipo (${modelPercent} %). La primera vez tarda.`}
        {phase === 'transcribing' && 'Transcribiendo en este equipo…'}
        {phase === 'recording' && 'Podés dictar de corrido o nombrar los apartados («Signos vitales», «Plan»). Si te equivocás, decí «corrijo» y el valor bueno.'}
      </p>
      {message ? <p className="text-sm text-red-700" role="alert">{message}</p> : null}

      {phase === 'ready' && draft ? (
        <div className="space-y-3">
          <p role="note" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
            Borrador armado a partir de tu dictado. Revisalo contra lo que dijiste antes de usarlo: no se guardó nada todavía.
            {recording && recording.size > DICTATION_AUDIO_MAX_BYTES
              ? ' Esta grabación es demasiado grande para guardarse junto a la evolución: va a quedar solo el texto.'
              : ` Al guardar la evolución, la grabación queda guardada ${DICTATION_AUDIO_RETENTION_DAYS} días.`}
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
          {draft.repetitions.length > 0 ? (
            <div role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
              <p className="font-semibold">El transcriptor se trabó y repitió una frase. Dejé una sola vez; en ese tramo puede faltar lo que dijiste. Revisalo o dictalo de nuevo:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {draft.repetitions.map((repetition, index) => (
                  <li key={index}>
                    «{repetition.phrase}» ({repetition.times} veces)
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {draft.layout === 'narrative' && draft.missing.length > 0 ? (
            <p className="text-xs text-alphi-muted">
              Dictaste de corrido: el borrador respeta tu texto. No escuché estos apartados, por si alguno corresponde:{' '}
              {draft.missing.map(titleOf).join(', ')}.
            </p>
          ) : null}
          {draft.layout === 'blocks' && missingCount > 0 ? (
            <p className="text-xs font-semibold text-amber-900">
              {missingCount} {missingCount === 1 ? 'bloque figura' : 'bloques figuran'} como «{NOT_MENTIONED}». Si lo dictaste, puede haber quedado dentro del bloque anterior: el título no se reconoció. Completalos o dejalos así a sabiendas.
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
            <button type="button" onClick={() => { setDraft(null); setText(''); setRecording(null); setPhase('idle') }} className="rounded border border-alphi-border px-3 py-1.5 text-sm font-semibold">
              Descartar el borrador
            </button>
          </div>
        </div>
      ) : null}
        </div>
        <DictationGuide />
      </div>
    </section>
  )
}
