import { DICTATION_AUDIO_MAX_TAKES } from './protocol'

/**
 * Varias grabaciones por evolución (docs/decisions/consulta-dictada.md, D22). Sin dependencias:
 * lo usan las rutas, la pantalla y el aviso que lee quien dicta, para que digan lo mismo.
 */

/** El número de toma de un pedido. Sin número es la primera; fuera de 1..tope, o mal escrito, `null`. */
export function parseTake(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return 1
  if (!/^[1-9]\d*$/.test(value)) return null
  const take = Number(value)
  return take <= DICTATION_AUDIO_MAX_TAKES ? take : null
}

/**
 * Las grabaciones que se van a subir al guardar la evolución, en el orden en que se dictaron.
 * Una toma sin grabación (demasiado grande) no ocupa lugar; pasado el tope no se suma.
 */
export function addRecordingTake<T>(takes: readonly T[], recording: T | null): T[] {
  if (recording === null || takes.length >= DICTATION_AUDIO_MAX_TAKES) return [...takes]
  return [...takes, recording]
}

/** Lo que lee quien dicta debajo del borrador: qué va a pasar con la grabación de esta toma. */
export function takesNotice(params: { takes: number; tooLarge: boolean; retentionDays: number }): string {
  const { takes, tooLarge, retentionDays } = params
  if (takes <= 1) {
    return tooLarge
      ? 'Esta grabación es demasiado grande para guardarse junto a la evolución: va a quedar solo el texto.'
      : `Al guardar la evolución, la grabación queda guardada ${retentionDays} días. Todavía no se guardó nada.`
  }
  if (takes > DICTATION_AUDIO_MAX_TAKES) {
    return `Se sumó a lo que ya estaba. Se guardan las grabaciones de las primeras ${DICTATION_AUDIO_MAX_TAKES} tomas; lo dictado después queda como texto.`
  }
  return tooLarge
    ? 'Se sumó a lo que ya estaba. Esta grabación es demasiado grande para guardarse: de esta toma queda solo el texto.'
    : `Se sumó a lo que ya estaba. Al guardar la evolución quedan guardadas las grabaciones de cada toma, ${retentionDays} días. Todavía no se guardó nada.`
}

export interface AudioListingItem {
  evolutionId: string
  /** Falta en la respuesta de una versión anterior: vale como la primera. */
  take?: number
  durationSec: number
  expiresAt: string
  available: boolean
}

/** El listado del sujeto, por evolución y en orden de toma. */
export function groupAudiosByEvolution<T extends AudioListingItem>(audios: readonly T[]): Record<string, Array<T & { take: number }>> {
  const grouped: Record<string, Array<T & { take: number }>> = {}
  for (const audio of audios) {
    const withTake = { ...audio, take: audio.take ?? 1 }
    ;(grouped[audio.evolutionId] ??= []).push(withTake)
  }
  for (const list of Object.values(grouped)) list.sort((a, b) => a.take - b.take)
  return grouped
}

export interface UploadResult {
  total: number
  failed: number
}

/**
 * Sube la grabación de cada toma, en orden, después de guardar la evolución. Una que falla no
 * frena a las siguientes: el texto ya está guardado y cada grabación vale por sí sola. Un 409
 * es «esa toma ya estaba» (un reintento), no una falla.
 */
export async function uploadRecordingTakes(params: {
  url: string
  takes: ReadonlyArray<{ blob: Blob; durationSec: number }>
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
}): Promise<UploadResult> {
  const send = params.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init))
  let failed = 0
  for (const [index, take] of params.takes.entries()) {
    try {
      const res = await send(params.url, {
        method: 'POST',
        headers: {
          'Content-Type': take.blob.type || 'audio/webm',
          'X-Duration-Sec': String(take.durationSec),
          'X-Take': String(index + 1),
        },
        body: take.blob,
      })
      if (!res.ok && res.status !== 409) failed += 1
    } catch {
      failed += 1
    }
  }
  return { total: params.takes.length, failed }
}

/** El aviso después de guardar, si alguna grabación no se guardó. `null`: nada que avisar. */
export function uploadNotice(result: UploadResult): string | null {
  if (result.failed === 0) return null
  if (result.total === 1) return 'La evolución se guardó. La grabación no se pudo guardar; el texto quedó completo.'
  const verb = result.failed === 1 ? 'no se pudo guardar' : 'no se pudieron guardar'
  return `La evolución se guardó. ${result.failed} de las ${result.total} grabaciones ${verb}; el texto quedó completo.`
}
