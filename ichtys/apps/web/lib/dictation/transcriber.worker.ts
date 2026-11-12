/// <reference lib="webworker" />
/**
 * Transcripción en el navegador (docs/decisions/consulta-dictada.md, D1 y D2).
 * Corre en un Web Worker para no trabar la pantalla. Lo único que viaja por la
 * red es la descarga del modelo, una vez: las muestras de audio no salen de acá.
 */
import { pipeline } from '@huggingface/transformers'
import { DICTATION_MODEL, DICTATION_MODEL_REVISION, type TranscriberEvent, type TranscriberRequest } from './protocol'

type Device = 'webgpu' | 'wasm'
type Transcriber = (samples: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>

const scope = self as unknown as DedicatedWorkerGlobalScope
const post = (event: TranscriberEvent) => scope.postMessage(event)

let loaded: { transcriber: Transcriber; device: Device } | null = null

async function load(): Promise<{ transcriber: Transcriber; device: Device }> {
  if (loaded) return loaded
  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
  const attempts: Device[] = hasWebGpu ? ['webgpu', 'wasm'] : ['wasm']
  let lastError: unknown
  for (const device of attempts) {
    try {
      const transcriber = (await pipeline('automatic-speech-recognition', DICTATION_MODEL, {
        device,
        revision: DICTATION_MODEL_REVISION,
        dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
        progress_callback: (progress: { status: string; progress?: number }) => {
          if (progress.status === 'progress_total' && typeof progress.progress === 'number') {
            post({ type: 'model-progress', percent: Math.round(progress.progress) })
          }
        },
      })) as unknown as Transcriber
      loaded = { transcriber, device }
      return loaded
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('model_load_failed')
}

scope.onmessage = async (message: MessageEvent<TranscriberRequest>) => {
  if (message.data.type !== 'transcribe') return
  try {
    const { transcriber, device } = await load()
    post({ type: 'transcribing', device })
    const output = await transcriber(message.data.samples, {
      language: 'spanish',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    })
    const text = Array.isArray(output) ? output.map((part) => part.text).join(' ') : output.text
    post({ type: 'result', text: text.trim(), device })
  } catch (error) {
    // Solo el nombre del error: nunca el contenido de lo dictado.
    post({ type: 'error', message: error instanceof Error ? error.name : 'transcription_failed' })
  }
}
