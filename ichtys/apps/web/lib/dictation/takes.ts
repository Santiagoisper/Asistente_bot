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
 * Las grabaciones que se van a subir al guardar la evolución. Cada una lleva el número de la
 * toma en que se dictó: si una toma no deja grabación (demasiado grande), su número queda sin
 * usar y la siguiente conserva el suyo. Así «toma 3» es la tercera parte de lo dictado, y quien
 * la escucha encuentra en el texto lo que busca. Pasado el tope de tomas no se suma.
 */
export function addRecordingTake<T extends object>(takes: ReadonlyArray<T & { take: number }>, recording: T | null, takeNumber: number): Array<T & { take: number }> {
  if (recording === null || takeNumber > DICTATION_AUDIO_MAX_TAKES) return [...takes]
  return [...takes, { ...recording, take: takeNumber }]
}

/** Las tomas, entre la primera y la última guardada, de las que no hay grabación. */
export function missingTakes(stored: readonly number[]): number[] {
  if (stored.length === 0) return []
  const present = new Set(stored)
  const missing: number[] = []
  for (let take = 1; take < Math.max(...stored); take += 1) if (!present.has(take)) missing.push(take)
  return missing
}

/** Lo que se dice junto a la evolución cuando falta la grabación de alguna toma. `null`: no falta ninguna. */
export function missingTakesNotice(missing: readonly number[]): string | null {
  if (missing.length === 0) return null
  if (missing.length === 1) return `De la toma ${missing[0]} no hay grabación guardada: quedó solo el texto.`
  const list = `${missing.slice(0, -1).join(', ')} y ${missing[missing.length - 1]}`
  return `De las tomas ${list} no hay grabación guardada: quedó solo el texto.`
}

/** Cómo se nombra una grabación junto a la evolución. Una sola, de la primera toma, no se numera. */
export function audioLabel(params: { take: number; several: boolean }): string {
  return params.several || params.take > 1 ? `Dictada · toma ${params.take}` : 'Dictada'
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
 * Sube la grabación de cada toma, en orden y con su número, después de guardar la evolución. Una que falla no
 * frena a las siguientes: el texto ya está guardado y cada grabación vale por sí sola. Un 409
 * es «esa toma ya estaba» (un reintento), no una falla.
 *
 * Una toma frenada por el límite de pedidos (429) no se da por perdida: el audio solo está en
 * la memoria del navegador. Se espera lo que el servidor pide y se reintenta **una** vez.
 */
export async function uploadRecordingTakes(params: {
  url: string
  takes: ReadonlyArray<{ blob: Blob; durationSec: number; take: number }>
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
  sleep?: (ms: number) => Promise<void>
}): Promise<UploadResult> {
  const send = params.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init))
  const sleep = params.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let failed = 0
  for (const take of params.takes) {
    const post = () =>
      send(params.url, {
        method: 'POST',
        headers: {
          'Content-Type': take.blob.type || 'audio/webm',
          'X-Duration-Sec': String(take.durationSec),
          'X-Take': String(take.take),
        },
        body: take.blob,
      })
    try {
      let res = await post()
      if (res.status === 429) {
        await sleep(retryWaitMs(res.headers.get('Retry-After')))
        res = await post()
      }
      if (!res.ok && res.status !== 409) failed += 1
    } catch {
      failed += 1
    }
  }
  return { total: params.takes.length, failed }
}

/** Sin un tiempo usable del servidor. */
const DEFAULT_RETRY_WAIT_MS = 5_000
/** La ventana del límite es de un minuto: esperar más que eso no tiene sentido. */
const MAX_RETRY_WAIT_MS = 65_000

function retryWaitMs(retryAfter: string | null): number {
  const seconds = Number(retryAfter)
  if (retryAfter === null || !Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_WAIT_MS
  return Math.min(MAX_RETRY_WAIT_MS, Math.ceil(seconds * 1000))
}

/** El aviso después de guardar, si alguna grabación no se guardó. `null`: nada que avisar. */
export function uploadNotice(result: UploadResult): string | null {
  if (result.failed === 0) return null
  if (result.total === 1) return 'La evolución se guardó. La grabación no se pudo guardar; el texto quedó completo.'
  const verb = result.failed === 1 ? 'no se pudo guardar' : 'no se pudieron guardar'
  return `La evolución se guardó. ${result.failed} de las ${result.total} grabaciones ${verb}; el texto quedó completo.`
}
