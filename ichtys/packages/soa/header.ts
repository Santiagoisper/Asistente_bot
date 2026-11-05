/**
 * header.ts — detección del encabezado de visitas, compartida por locate.ts
 * y grid.ts (una sola fuente de verdad: si locate acepta una página por su
 * encabezado, grid tiene que encontrarle las mismas columnas).
 *
 * Dos formas de encabezado:
 *   1. CON PREFIJO — fichas tipo V1, S3, W12, SCR… (`VISIT_TOKEN`). Gana
 *      siempre que haya al menos 2.
 *   2. NUMÉRICO — una fila con ETIQUETA ("Número de visita", "Visit
 *      number", "Día"…) seguida de enteros sin prefijo (1, 2, 3 … 16) donde
 *      un guion ("-", "–", "—") es una columna sin número. Se repite en cada
 *      página. Sin etiqueta una fila de enteros NO es encabezado: es dato.
 *
 * El texto del documento (etiquetas, fichas) se devuelve al llamador pero
 * nunca se loguea (S8).
 */
import type { TextItem } from './types'

/** Fichas de visita con prefijo en el encabezado (V1, VR3, W12, SCR, DT, FA, SEL…). */
export const VISIT_TOKEN =
  /^(V|VR|S|W|D)\d+$|^(SCR|DT|FA|SEL|ET|FU|EOS|EOT|VNP|VF|VME\d+|VDT|VME)$/i

/** Una columna sin número en el encabezado numérico (se normaliza a "—"). */
export const DASH_TOKEN = '—'

const NUMERIC_TOKEN_RE = /^(\d{1,3}|[-–—])$/

/** Mínimo de enteros para que la fila cuente como encabezado (con etiqueta). */
const MIN_NUMERIC_COLUMNS = 3
/** Tolerancia de techo de caja para considerar dos fichas de la misma línea (pt). */
const SAME_LINE_TOLERANCE = 1.5
/** Ventana vertical (pt) alrededor de la línea de fichas donde se busca la etiqueta. */
const LABEL_WINDOW = 9
/** Separación x mínima entre fichas distintas (pt): menos es un solape, no dos columnas. */
const MIN_TOKEN_GAP = 1

/** Etiquetas de visita (prioridad alta): normalizadas sin tildes ni puntuación. */
const VISIT_LABEL_RES: RegExp[] = [
  /^(numero|num|nro|n|no)( de)? visita$/,
  /^visita( (numero|num|nro|no))?$/,
  /^visit( (number|no|num))?$/,
  /^visits$/,
]
/** Etiquetas de eje temporal (prioridad baja): una fila "Día" bajo un encabezado de visitas no lo reemplaza. */
const TIME_LABEL_RES: RegExp[] = [
  /^(dia|dias|day|days|semana|semanas|week|weeks)$/,
  /^(dia|dias) de(l)? estudio$/,
  /^study day$/,
]

export interface NumericHeader {
  /** Techo de caja de la línea de fichas (comparable con `band.y` de las bandas de texto). */
  y: number
  /** 'visit' (etiqueta de visita) o 'time' (Día / Semana): la primera gana a la segunda. */
  kind: 'visit' | 'time'
  /** Fichas de la fila en orden x: enteros y guiones (cada una con su caja propia). */
  tokens: TextItem[]
  /** Ítems de la etiqueta de fila (se excluyen de las columnas). */
  labelItems: TextItem[]
  /** Los enteros en orden de lectura (estrictamente crecientes). */
  integers: number[]
}

function normalizeLabel(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[º°]/g, '')
    .replace(/[:.#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normaliza una ficha numérica: cualquier guion pasa al mismo token. */
export function normalizeNumericToken(text: string): string {
  const s = text.replace(/\s+/g, '')
  return /^[-–—]$/.test(s) ? DASH_TOKEN : s
}

/**
 * Parte un ítem cuyo texto trae varias fichas numéricas ("1 - 2") en una caja
 * por ficha, repartiendo el ancho por posición de carácter. Si alguna parte
 * no es ficha numérica, devuelve el ítem tal cual (no es un candidato).
 */
function splitNumericItem(item: TextItem): TextItem[] {
  const raw = item.str
  const parts = [...raw.matchAll(/\S+/g)]
  if (parts.length <= 1) return [item]
  if (!parts.every((m) => NUMERIC_TOKEN_RE.test(m[0]))) return [item]
  const width = item.bbox[2] - item.bbox[0]
  const total = Math.max(raw.length, 1)
  return parts.map((m) => {
    const start = m.index ?? 0
    return {
      ...item,
      str: m[0],
      bbox: [
        item.bbox[0] + (width * start) / total,
        item.bbox[1],
        item.bbox[0] + (width * (start + m[0].length)) / total,
        item.bbox[3],
      ],
    }
  })
}

/** Etiqueta de la fila: líneas a la izquierda de la primera ficha, solas o de a dos (etiqueta partida en dos líneas). */
function labelKindOf(left: TextItem[]): 'visit' | 'time' | null {
  const lines: Array<{ top: number; items: TextItem[] }> = []
  for (const item of [...left].sort((a, b) => b.bbox[3] - a.bbox[3])) {
    const line = lines.find((l) => Math.abs(l.top - item.bbox[3]) <= 2)
    if (line) line.items.push(item)
    else lines.push({ top: item.bbox[3], items: [item] })
  }
  const texts = lines.map((l) =>
    normalizeLabel(
      [...l.items]
        .sort((a, b) => a.bbox[0] - b.bbox[0])
        .map((i) => i.str.trim())
        .join(' '),
    ),
  )
  const candidates = [...texts]
  for (let i = 0; i + 1 < texts.length; i++) candidates.push(`${texts[i]} ${texts[i + 1]}`)
  if (candidates.some((c) => VISIT_LABEL_RES.some((re) => re.test(c)))) return 'visit'
  if (candidates.some((c) => TIME_LABEL_RES.some((re) => re.test(c)))) return 'time'
  return null
}

/**
 * Busca el encabezado numérico de una página: la fila etiquetada de
 * enteros crecientes con guiones como columnas sin número. Prioridad: una
 * etiqueta de visita gana a una de eje temporal; a igualdad, la fila de más
 * arriba. Determinista y puro.
 */
export function findNumericHeader(items: TextItem[]): NumericHeader | null {
  const tokens = items
    .filter((i) => i.fontSize >= 4 && !i.rotated && i.str.trim().length > 0)
    .flatMap(splitNumericItem)
    .filter((i) => NUMERIC_TOKEN_RE.test(i.str.trim()))
    .sort((a, b) => b.bbox[3] - a.bbox[3] || a.bbox[0] - b.bbox[0])

  // Líneas: fichas con el mismo techo de caja (± tolerancia).
  const lines: TextItem[][] = []
  for (const token of tokens) {
    const line = lines.find((l) => Math.abs(l[0]!.bbox[3] - token.bbox[3]) <= SAME_LINE_TOLERANCE)
    if (line) line.push(token)
    else lines.push([token])
  }

  let best: NumericHeader | null = null
  for (const line of lines) {
    const row = [...line].sort((a, b) => a.bbox[0] - b.bbox[0])
    const integers = row
      .filter((t) => /^\d/.test(t.str.trim()))
      .map((t) => Number(t.str.trim()))
    if (integers.length < MIN_NUMERIC_COLUMNS) continue
    // Estrictamente creciente en x: una secuencia desordenada es dato, no encabezado.
    if (!integers.every((n, i) => i === 0 || n > integers[i - 1]!)) continue
    // Fichas separadas: dos cajas solapadas no son dos columnas.
    if (!row.every((t, i) => i === 0 || t.bbox[0] - row[i - 1]!.bbox[2] >= -MIN_TOKEN_GAP)) continue

    const firstX = row[0]!.bbox[0]
    const top = row[0]!.bbox[3]
    const bottom = Math.min(...row.map((t) => t.bbox[1]))
    const labelItems = items.filter((i) => {
      const s = i.str.trim()
      if (s.length === 0 || i.rotated || i.bbox[2] > firstX + 2) return false
      const cy = (i.bbox[1] + i.bbox[3]) / 2
      return cy >= bottom - LABEL_WINDOW && cy <= top + LABEL_WINDOW
    })
    const kind = labelKindOf(labelItems)
    if (kind === null) continue

    const candidate: NumericHeader = { y: top, kind, tokens: row, labelItems, integers }
    if (
      best === null ||
      (candidate.kind === 'visit' && best.kind === 'time') ||
      (candidate.kind === best.kind && candidate.y > best.y)
    ) {
      best = candidate
    }
  }
  return best
}
