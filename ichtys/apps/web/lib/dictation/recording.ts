/**
 * Formato y tope de la grabación del dictado (docs/decisions/consulta-dictada.md, D14 y D25).
 * Sin dependencias: se prueba sin navegador.
 *
 * El grabador pide 24 kbps, pero es un pedido. Medido el 14/11/2026: donde el navegador graba
 * en mp4 sale a unos 187 kbps, y el tope por grabación (el cuerpo de un pedido a la plataforma)
 * se alcanza a los 2 minutos 50 en vez de a los veinte.
 */

/** Formatos que respetan la calidad pedida, en orden de preferencia. */
const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus'] as const

/**
 * El formato que se le pide al grabador, o `undefined` para dejarle el suyo. Solo se elige uno
 * que el equipo sepa grabar **y** leer: la transcripción corre en el mismo equipo, y un audio
 * que no se puede leer no se puede transcribir.
 */
export function pickRecordingMimeType(
  canRecord: (type: string) => boolean,
  canRead: (type: string) => boolean,
): string | undefined {
  try {
    return PREFERRED_MIME_TYPES.find((type) => canRecord(type) && canRead(type))
  } catch {
    return undefined
  }
}

export interface RecordingBudget {
  /** `true`: hay que detener la toma ahora, o el próximo tramo ya no entra. */
  stop: boolean
  /** Segundos que quedan al ritmo de lo grabado; `null` mientras no hay con qué estimar. */
  secondsLeft: number | null
}

/** Segundos de grabación antes de estimar: el primer tramo trae el encabezado y no es parejo. */
const MIN_SECONDS_TO_ESTIMATE = 3

/**
 * Cuánto falta para el tope, con lo que el grabador entregó hasta ahora. Corta con margen de
 * dos tramos: el que ya se está grabando y el de cierre.
 */
export function recordingBudget(input: { bytes: number; seconds: number; lastChunkBytes: number; maxBytes: number }): RecordingBudget {
  const { bytes, seconds, lastChunkBytes, maxBytes } = input
  if (bytes > 0 && bytes + 2 * lastChunkBytes >= maxBytes) return { stop: true, secondsLeft: 0 }
  if (bytes <= 0 || seconds < MIN_SECONDS_TO_ESTIMATE) return { stop: false, secondsLeft: null }
  const bytesPerSecond = bytes / seconds
  return { stop: false, secondsLeft: Math.max(0, Math.floor((maxBytes - bytes) / bytesPerSecond)) }
}

/** Desde cuántos segundos antes del tope se avisa. */
const WARNING_SECONDS = 60

/** El aviso para quien dicta, o `null` si todavía no hay nada que decir. */
export function takeLimitNotice(budget: RecordingBudget): string | null {
  if (budget.stop) {
    return 'Esta toma llegó al tope de grabación de este equipo y se detuvo sola. Lo dictado se transcribe y la grabación se guarda. Para seguir, grabá otra toma.'
  }
  if (budget.secondsLeft === null || budget.secondsLeft > WARNING_SECONDS) return null
  return `Quedan ${budget.secondsLeft} segundos de grabación en esta toma. Cuando se corte, lo dictado se transcribe y podés seguir con otra toma.`
}
