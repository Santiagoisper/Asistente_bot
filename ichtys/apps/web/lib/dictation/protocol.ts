/** Mensajes entre la pantalla y el Web Worker que transcribe. */
export const DICTATION_MODEL = 'onnx-community/whisper-small'
/**
 * Revisión del modelo. Hoy es la rama principal del repositorio del modelo:
 * fijarla a un identificador de commit antes de usarlo con datos reales
 * (docs/decisions/consulta-dictada.md, D2). Es lo que queda en el registro.
 */
export const DICTATION_MODEL_REVISION = 'main'

export type TranscriberRequest = { type: 'transcribe'; samples: Float32Array }

export type TranscriberEvent =
  | { type: 'model-progress'; percent: number }
  | { type: 'transcribing'; device: 'webgpu' | 'wasm' }
  | { type: 'result'; text: string; device: 'webgpu' | 'wasm' }
  | { type: 'error'; message: string }
