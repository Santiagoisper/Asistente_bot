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

/** `segments`: pares [inicio, fin) en muestras. Cada tramo se transcribe por separado (D15). */
export type TranscriberRequest = { type: 'transcribe'; samples: Float32Array; segments: Array<[number, number]> }

export type TranscriberEvent =
  | { type: 'model-progress'; percent: number }
  | { type: 'transcribing'; device: 'webgpu' | 'wasm'; done: number; total: number }
  | { type: 'result'; text: string; device: 'webgpu' | 'wasm' }
  | { type: 'error'; message: string }

/**
 * Conservación de la grabación (docs/decisions/consulta-dictada.md, D14). Vive acá, sin
 * dependencias, porque lo usan el servidor y el aviso que lee quien dicta: los dos dicen lo mismo.
 * Santiago lo confirmó el 14/11/2026 («30 días correcto hoy»). Antes era un valor de resguardo.
 */
export const DICTATION_AUDIO_RETENTION_DAYS = 30
/** Tope por grabación. El cuerpo de un pedido a la plataforma no pasa de 4,5 MB. */
export const DICTATION_AUDIO_MAX_BYTES = 4_000_000
/**
 * Tope de grabaciones por evolución (D22): una por toma. PROVISORIO, sin medir con uso real:
 * pasado el tope, lo dictado queda como texto y la pantalla lo dice.
 */
export const DICTATION_AUDIO_MAX_TAKES = 5
/**
 * Hasta cuánto se cuenta la cantidad de tomas de un dictado (D22). No es un tope de dictado:
 * se puede seguir dictando. Es el mayor número que viaja y se guarda con la evolución; la
 * pantalla manda este valor si se pasa, para que un contador nunca haga rechazar el guardado.
 */
export const DICTATION_TAKES_COUNT_MAX = 99
/**
 * Voz a 24 kbps: veinte minutos entran en el tope con margen. Es un pedido al navegador, no una
 * garantía: donde graba en mp4 (medido el 14/11/2026) sale a unos 187 kbps y el tope se alcanza
 * a los 2 minutos 50. Por eso el panel cuenta lo que pesa la toma y la detiene antes del tope
 * (docs/decisions/consulta-dictada.md, D25; `recording.ts`).
 */
export const DICTATION_RECORDING_BITS_PER_SECOND = 24_000
