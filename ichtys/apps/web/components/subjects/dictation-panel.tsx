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
import { takesNotice } from '../../lib/dictation/takes'
import { useMicLevel } from '../../lib/dictation/use-mic-level'
import { pickRecordingMimeType, recordingBudget, takeLimitNotice } from '../../lib/dictation/recording'
import { RecordingNotice } from './recording-notice'
import { RecordButton } from './record-button'

export interface DictationSource {
  kind: 'dictation'
  durationSec: number
  model: string
  modelRevision: string
  corrections: number
  missingBlocks: number
  /**
   * El código del sujeto que la persona confirmó en el aviso, antes de grabar o de subir el
   * audio (D23). El servidor lo compara con el sujeto donde se guarda la evolución.
   */
  confirmedSubjectCode?: string
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
  /** Código del sujeto en pantalla. El aviso de antes de grabar lo nombra (D23). */
  subjectCode: string
  /** El borrador está listo: la pantalla lo pone en el cuadro de la evolución. */
  onDraft: (draft: DictationDraft, source: DictationSource, recording: DictationRecording | null) => void
  /** La persona descartó el dictado: la pantalla saca el texto y la grabación. */
  onDiscard: () => void
  /** Cambia cuando la evolución se guardó: el panel vuelve a su estado inicial. */
  resetSignal: number
}

type Phase = 'idle' | 'recording' | 'paused' | 'preparing' | 'model' | 'transcribing' | 'ready' | 'error'

/** Tope de una grabación: pasado esto se detiene sola y se transcribe lo grabado. */
const MAX_RECORDING_SEC = 20 * 60
/** Segundos sin voz al empezar para avisar que el micrófono no está tomando nada. */
const SILENCE_WARNING_SEC = 4
const SILENCE_LEVEL = 0.06
/** Cada cuánto entrega un tramo el grabador. Con un segundo, la cuenta de tramos es el tiempo grabado. */
const RECORDING_TIMESLICE_MS = 1000

export function DictationPanel({ subjectCode, onDraft, onDiscard, resetSignal }: DictationPanelProps) {
  /**
   * El aviso se acepta una vez por evolución (D23): al guardar o descartar, el dictado
   * siguiente lo vuelve a pedir, porque puede ser de otro sujeto. Se guarda el código que se
   * confirmó y no un sí: si el sujeto en pantalla cambia, lo confirmado para el anterior no vale.
   */
  const [confirmedCode, setConfirmedCode] = useState<string | null>(null)
  const [asking, setAsking] = useState<'record' | 'upload' | null>(null)
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
  /** Aviso del tope de la grabación: cuánto queda en esta toma, o que se detuvo sola (D25). */
  const [limitNotice, setLimitNotice] = useState<string | null>(null)
  /** Cuántas tomas lleva este dictado. Desde la segunda, lo dictado se suma a lo que ya está. */
  const [takes, setTakes] = useState(0)
  const level = useMicLevel(phase === 'recording' ? stream : null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const previewRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const confirmedCodeRef = useRef<string | null>(null)
  const currentCode = subjectCode.trim()
  const confirmed = confirmedCode !== null && confirmedCode === currentCode

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
    setLimitNotice(null)
    setMessage(null)
    setTakes(0)
    setPhase('idle')
    confirmedCodeRef.current = null
    setConfirmedCode(null)
    setAsking(null)
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
          setTakes((value) => value + 1)
          onDraft(
            built,
            {
              kind: 'dictation',
              durationSec,
              model: DICTATION_MODEL,
              modelRevision: DICTATION_MODEL_REVISION,
              corrections: built.corrections.length,
              missingBlocks: built.missing.length,
              ...(confirmedCodeRef.current ? { confirmedSubjectCode: confirmedCodeRef.current } : {}),
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
      // Se pide un formato que respete la calidad pedida, si este equipo lo graba y lo lee (D25).
      const mimeType = pickRecordingMimeType(
        (type) => MediaRecorder.isTypeSupported(type),
        (type) => document.createElement('audio').canPlayType(type) !== '',
      )
      const recorder = new MediaRecorder(media, {
        audioBitsPerSecond: DICTATION_RECORDING_BITS_PER_SECOND,
        ...(mimeType ? { mimeType } : {}),
      })
      const chunks: Blob[] = []
      let bytes = 0
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return
        chunks.push(event.data)
        bytes += event.data.size
        // Un tramo por segundo: la cantidad de tramos es el tiempo grabado, sin contar las pausas.
        const budget = recordingBudget({
          bytes,
          seconds: chunks.length,
          lastChunkBytes: event.data.size,
          maxBytes: DICTATION_AUDIO_MAX_BYTES,
        })
        setLimitNotice(takeLimitNotice(budget))
        // Antes de pasarse del tope se detiene sola: se transcribe y se guarda lo grabado.
        if (budget.stop && recorder.state !== 'inactive') recorder.stop()
      }
      recorder.onstop = () => {
        media.getTracks().forEach((track) => track.stop())
        setStream(null)
        stopTimer()
        void transcribe(new Blob(chunks, { type: recorder.mimeType }))
      }
      recorderRef.current = recorder
      setLimitNotice(null)
      // Un tramo por segundo, para saber cuánto pesa lo grabado mientras se graba.
      recorder.start(RECORDING_TIMESLICE_MS)
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

  /** Aceptó el aviso que nombra al sujeto: sigue con lo que había pedido. */
  function acceptNotice() {
    const next = asking
    confirmedCodeRef.current = currentCode
    setConfirmedCode(currentCode)
    setAsking(null)
    if (next === 'record') void startRecording()
    else if (next === 'upload') fileInputRef.current?.click()
  }

  function discard() {
    setDraft(null)
    setPreview(null)
    setTooLarge(false)
    setLimitNotice(null)
    setMessage(null)
    setTakes(0)
    setPhase('idle')
    confirmedCodeRef.current = null
    setConfirmedCode(null)
    setAsking(null)
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
              adding={takes > 0}
              onStart={() => {
                if (!confirmed) setAsking('record')
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
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,video/mp4,video/webm"
                  className="sr-only"
                  onClick={(event) => {
                    // Sin el aviso aceptado no se abre el selector: primero se confirma el sujeto.
                    // Se mira la referencia y no el estado: al aceptar, el clic programado llega
                    // antes de que la pantalla se vuelva a dibujar.
                    if (confirmedCodeRef.current !== null && confirmedCodeRef.current === currentCode) return
                    event.preventDefault()
                    setAsking('upload')
                  }}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void transcribe(file)
                  }}
                />
              </label>
            )}
          </div>

          {asking && !confirmed ? (
            <RecordingNotice
              subjectCode={subjectCode}
              retentionDays={DICTATION_AUDIO_RETENTION_DAYS}
              action={asking}
              onAccept={acceptNotice}
              onCancel={() => setAsking(null)}
            />
          ) : null}

          {busy || active ? (
            <p className="text-xs text-alphi-muted" role="status">
              {phase === 'preparing' && 'Preparando el audio…'}
              {phase === 'model' && `Cargando el modelo en este equipo (${modelPercent} %). La primera vez tarda.`}
              {phase === 'transcribing' && `Transcribiendo en este equipo… ${progress.total > 0 ? `(${progress.done + 1} de ${progress.total})` : ''}`}
              {active && 'Podés dictar de corrido o nombrar los apartados. Si te equivocás, decí «corrijo» y el dato bueno.'}
            </p>
          ) : null}
          {limitNotice ? <p className="text-sm font-medium text-alphi-amber" role="status">{limitNotice}</p> : null}
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
                {takesNotice({ takes, tooLarge, retentionDays: DICTATION_AUDIO_RETENTION_DAYS })}
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
                Descartar todo y empezar de nuevo
              </button>
            </div>
          ) : null}
    </section>
  )
}
