'use client'

/**
 * Dictado de la evolución (docs/decisions/consulta-dictada.md).
 *
 * Graba (con pausa) o recibe un audio, lo transcribe en este equipo y le entrega
 * el borrador a la pantalla, que lo pone en el cuadro de la evolución: hay un solo
 * cuadro de texto y un solo botón de guardar. Este panel no guarda nada: muestra
 * los controles, la grabación para volver a escucharla y los avisos del borrador.
 * La guía para dictar la ubica la pantalla, al lado de todo el formulario. La grabación sale del equipo recién cuando la persona guarda (D14).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildDictationDraft, DICTATION_BLOCKS, type DictationDraft } from '@ichtys/clinical'
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

/** La grabación de la que salió el borrador. Se sube recién cuando la persona guarda la evolución. */
export interface DictationRecording {
  blob: Blob
  durationSec: number
}

export interface DictationPanelProps {
  /** El borrador está listo: la pantalla lo pone en el cuadro de la evolución. */
  onDraft: (text: string, source: DictationSource, recording: DictationRecording | null) => void
  /** La persona descartó el dictado: la pantalla saca el texto y la grabación. */
  onDiscard: () => void
  /** Cambia cuando la evolución se guardó: el panel vuelve a su estado inicial. */
  resetSignal: number
}

type Phase = 'idle' | 'recording' | 'paused' | 'preparing' | 'model' | 'transcribing' | 'ready' | 'error'

const CONSENT_KEY = 'alphi-dictation-consent'
/** Tope de una grabación: pasado esto se detiene sola y se transcribe lo grabado. */
const MAX_RECORDING_SEC = 20 * 60
/** Segundos sin voz al empezar para avisar que el micrófono no está tomando nada. */
const SILENCE_WARNING_SEC = 4
const SILENCE_LEVEL = 0.06

function readConsent(): boolean {
  try {
    return sessionStorage.getItem(CONSENT_KEY) === 'yes'
  } catch {
    return false
  }
}

export function DictationPanel({ onDraft, onDiscard, resetSignal }: DictationPanelProps) {
  const [consent, setConsent] = useState(false)
  const [askingConsent, setAskingConsent] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [modelPercent, setModelPercent] = useState(0)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [message, setMessage] = useState<string | null>(null)
  const [draft, setDraft] = useState<DictationDraft | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [heardVoice, setHeardVoice] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [tooLarge, setTooLarge] = useState(false)
  const level = useMicLevel(phase === 'recording' ? stream : null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const previewRef = useRef<string | null>(null)

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }
  const startTimer = () => {
    stopTimer()
    timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000)
  }
  const setPreview = (blob: Blob | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = blob ? URL.createObjectURL(blob) : null
    setPreviewUrl(previewRef.current)
  }

  useEffect(() => {
    setConsent(readConsent())
    return () => {
      stopTimer()
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
      workerRef.current?.terminate()
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    }
  }, [])

  // La evolución se guardó: el panel queda listo para el dictado siguiente.
  useEffect(() => {
    if (resetSignal === 0) return
    setDraft(null)
    setPreview(null)
    setTooLarge(false)
    setMessage(null)
    setPhase('idle')
  }, [resetSignal])

  // Avisar si pasan unos segundos y todavía no entró voz; tope de duración.
  useEffect(() => {
    if (phase === 'recording' && level > SILENCE_LEVEL) setHeardVoice(true)
  }, [phase, level])
  useEffect(() => {
    if ((phase === 'recording' || phase === 'paused') && seconds >= MAX_RECORDING_SEC) recorderRef.current?.stop()
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
      setPreview(blob)
      let prepared
      try {
        prepared = await prepareAudio(blob)
      } catch {
        fail('No se pudo leer el audio. Probá con otro archivo o grabá de nuevo.')
        return
      }
      if (prepared.segments.length === 0) {
        fail('El audio no tiene voz para transcribir.')
        return
      }
      const durationSec = prepared.durationSec
      setPhase('model')
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL('../../lib/dictation/transcriber.worker.ts', import.meta.url), { type: 'module' })
      }
      const worker = workerRef.current
      worker.onmessage = (event: MessageEvent<TranscriberEvent>) => {
        const data = event.data
        if (data.type === 'model-progress') setModelPercent(data.percent)
        else if (data.type === 'transcribing') {
          setPhase('transcribing')
          setProgress({ done: data.done, total: data.total })
        }
        else if (data.type === 'result') {
          const built = buildDictationDraft(data.text)
          const fits = blob.size <= DICTATION_AUDIO_MAX_BYTES
          setDraft(built)
          setTooLarge(!fits)
          setPhase('ready')
          onDraft(
            built.text,
            {
              kind: 'dictation',
              durationSec,
              model: DICTATION_MODEL,
              modelRevision: DICTATION_MODEL_REVISION,
              corrections: built.corrections.length,
              missingBlocks: built.missing.length,
              layout: built.layout,
              repetitions: built.repetitions.length,
            },
            fits ? { blob, durationSec } : null,
          )
        } else fail('No se pudo transcribir en este equipo. El audio no salió de acá; podés escribir la evolución a mano.')
      }
      worker.onerror = () => fail('No se pudo transcribir en este equipo. El audio no salió de acá; podés escribir la evolución a mano.')
      worker.postMessage(
        { type: 'transcribe', samples: prepared.samples, segments: prepared.segments.map((segment) => [segment.start, segment.end]) },
        [prepared.samples.buffer],
      )
    },
    [fail, onDraft],
  )

  async function startRecording() {
    setMessage(null)
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      const recorder = new MediaRecorder(media, { audioBitsPerSecond: DICTATION_RECORDING_BITS_PER_SECOND })
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        media.getTracks().forEach((track) => track.stop())
        setStream(null)
        stopTimer()
        void transcribe(new Blob(chunks, { type: recorder.mimeType }))
      }
      recorderRef.current = recorder
      recorder.start()
      setStream(media)
      setHeardVoice(false)
      setSeconds(0)
      setPhase('recording')
      startTimer()
    } catch {
      fail('No hay acceso al micrófono. Dale permiso al navegador o subí un audio.')
    }
  }

  function pauseRecording() {
    if (recorderRef.current?.state !== 'recording') return
    recorderRef.current.pause()
    stopTimer()
    setPhase('paused')
  }

  function resumeRecording() {
    if (recorderRef.current?.state !== 'paused') return
    recorderRef.current.resume()
    startTimer()
    setPhase('recording')
  }

  function acceptConsent() {
    try {
      sessionStorage.setItem(CONSENT_KEY, 'yes')
    } catch {
      // Sin almacenamiento de sesión: el aviso se vuelve a mostrar la próxima vez.
    }
    setConsent(true)
  }

  function discard() {
    setDraft(null)
    setPreview(null)
    setTooLarge(false)
    setMessage(null)
    setPhase('idle')
    onDiscard()
  }

  const busy = phase === 'preparing' || phase === 'model' || phase === 'transcribing'
  const active = phase === 'recording' || phase === 'paused'
  const titleOf = (id: string): string => DICTATION_BLOCKS.find((block) => block.id === id)?.title ?? id

  return (
    <section className="space-y-3" aria-label="Dictar la evolución">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <RecordButton
              state={phase === 'recording' ? 'recording' : phase === 'paused' ? 'paused' : busy ? 'busy' : 'idle'}
              seconds={seconds}
              level={level}
              silent={phase === 'recording' && !heardVoice && seconds >= SILENCE_WARNING_SEC}
              onStart={() => {
                if (!consent) setAskingConsent(true)
                else void startRecording()
              }}
              onPause={pauseRecording}
              onResume={resumeRecording}
              onStop={() => recorderRef.current?.stop()}
            />
            {active ? null : (
              <label className={`alphi-btn-secondary cursor-pointer ${busy ? 'pointer-events-none opacity-40' : ''}`}>
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
            )}
          </div>

          {askingConsent && !consent ? (
            <div className="space-y-2 rounded-lg border border-alphi-border bg-alphi-slate p-3 text-sm" role="group" aria-label="Antes de grabar">
              <p>
                Se graba <strong>tu dictado</strong> para armar un borrador. El audio se transcribe en este equipo. Si guardás la
                evolución, la grabación se guarda cifrada junto a ella durante {DICTATION_AUDIO_RETENTION_DAYS} días y después se
                borra; si descartás el dictado, no se guarda nada. Grabar a un paciente exige su consentimiento.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    acceptConsent()
                    setAskingConsent(false)
                    void startRecording()
                  }}
                  className="alphi-btn-primary"
                >
                  Entendido, empezar a grabar
                </button>
                <button type="button" onClick={() => setAskingConsent(false)} className="alphi-btn-secondary">
                  Ahora no
                </button>
              </div>
            </div>
          ) : null}

          {busy || active ? (
            <p className="text-xs text-alphi-muted" role="status">
              {phase === 'preparing' && 'Preparando el audio…'}
              {phase === 'model' && `Cargando el modelo en este equipo (${modelPercent} %). La primera vez tarda.`}
              {phase === 'transcribing' && `Transcribiendo en este equipo… ${progress.total > 0 ? `(${progress.done + 1} de ${progress.total})` : ''}`}
              {active && 'Podés dictar de corrido o nombrar los apartados. Si te equivocás, decí «corrijo» y el dato bueno.'}
            </p>
          ) : null}
          {message ? <p className="text-sm font-medium text-alphi-rose" role="alert">{message}</p> : null}

          {phase === 'ready' && draft ? (
            <div className="space-y-3 rounded-lg border border-alphi-border bg-white p-3">
              <p className="text-sm font-semibold text-alphi-navy">
                El dictado está abajo, en «Evolución clínica». Revisalo, corregí lo que haga falta y tocá «Guardar evolución».
              </p>
              {previewUrl ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-semibold text-alphi-muted">Tu grabación</span>
                  <audio controls src={previewUrl} className="h-9 max-w-full" />
                </div>
              ) : null}
              <p className="text-xs text-alphi-muted">
                {tooLarge
                  ? 'Esta grabación es demasiado grande para guardarse junto a la evolución: va a quedar solo el texto.'
                  : `Al guardar la evolución, la grabación queda guardada ${DICTATION_AUDIO_RETENTION_DAYS} días. Todavía no se guardó nada.`}
              </p>
              {draft.repetitions.length > 0 ? (
                <div role="alert" className="rounded border border-alphi-rose bg-red-50 px-3 py-2 text-xs text-red-900">
                  <p className="font-semibold">El transcriptor se trabó y repitió una frase. Dejé una sola vez; en ese tramo puede faltar lo que dijiste. Escuchá la grabación y completalo:</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {draft.repetitions.map((repetition, index) => (
                      <li key={index}>
                        «{repetition.phrase}» ({repetition.times} veces)
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
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
              {draft.missing.length > 0 ? (
                <p className={`text-xs ${draft.layout === 'blocks' ? 'font-semibold text-alphi-amber' : 'text-alphi-muted'}`}>
                  {draft.layout === 'blocks'
                    ? 'No escuché estos apartados (en el texto figuran como «No mencionado»). Si los dictaste, pueden haber quedado dentro del anterior: '
                    : 'Dictaste de corrido: el texto respeta lo que dijiste. No escuché estos apartados, por si alguno corresponde: '}
                  {draft.missing.map(titleOf).join(', ')}.
                </p>
              ) : null}
              <button type="button" onClick={discard} className="alphi-btn-secondary">
                Descartar y grabar de nuevo
              </button>
            </div>
          ) : null}
    </section>
  )
}
