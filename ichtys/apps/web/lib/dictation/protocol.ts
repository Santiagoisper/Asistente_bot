/** Mensajes entre la pantalla y el Web Worker que transcribe. */
export const DICTATION_MODEL = 'onnx-community/whisper-small'
/**
 * Revisión del modelo, fijada por identificador de commit (docs/decisions/consulta-dictada.md,
 * D2): los pesos no cambian entre una descarga y otra, y lo que queda en el registro dice
 * exactamente con qué se transcribió. Es el commit al que apuntaba la rama principal del
 * repositorio del modelo el 12/11/2026 (última modificación: 19/06/2025), el mismo con el
 * que se hicieron las pruebas de ese día. Cambiarlo es un cambio controlado (R9).
 */
export const DICTATION_MODEL_REVISION = '36050c46d777d46dc4b5f43f6d90574fc38f8732'

export type TranscriberRequest = { type: 'transcribe'; samples: Float32Array }

export type TranscriberEvent =
  | { type: 'model-progress'; percent: number }
  | { type: 'transcribing'; device: 'webgpu' | 'wasm' }
  | { type: 'result'; text: string; device: 'webgpu' | 'wasm' }
  | { type: 'error'; message: string }
