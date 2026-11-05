/**
 * header.ts — detección del encabezado de visitas, compartida por locate.ts
 * y grid.ts (una sola fuente de verdad: si locate acepta una página por su
 * encabezado, grid tiene que encontrarle las mismas columnas).
 *
 * Dos formas de encabezado:
 *   1. CON PREFIJO — fichas de ID de visita (V1, VR3, SCR, DT…). Gana
 *      siempre que haya al menos 2. Las fichas de TIEMPO (S12, W3, D-14)
 *      NUNCA definen columnas cuando hay fila de ids (G18 §3.2, extensión de
 *      K2: el tiempo nunca es id de visita); si la fila de tiempo es la
 *      ÚNICA del encabezado, esa fila es la línea de ids (F5 replica R3:
 *      semanas como identidad de visita).
 *   2. NUMÉRICO — una fila con ETIQUETA ("Número de visita", "Visit
 *      number", "Día"…) seguida de enteros sin prefijo (1, 2, 3 … 16) donde
 *      un guion ("-", "–", "—") es una columna sin número. Se repite en cada
 *      página. Sin etiqueta una fila de enteros NO es encabezado: es dato.
 *
 * P2c — TIRAS y FICHA PARTIDA (protocolo real de 46 columnas): una página
 * puede apilar VARIAS tiras de encabezado, cada una con su etiqueta y sus
 * filas de datos colgando; la ficha se imprime PARTIDA en dos filas — el
 * prefijo (letras) unos puntos ARRIBA del número, alineado en x. El plural
 * (`findNumericHeaders`) devuelve todas las tiras de la página, de arriba a
 * abajo; una banda de eje temporal («Día», «Semana») bajo una tira de visitas
 * es estructura de esa grilla, no una tira propia.
 *
 * El texto del documento (etiquetas, fichas) se devuelve al llamador pero
 * nunca se loguea (S8).
 */
import type { TextItem } from './types'

/** Fichas de ID de visita en el encabezado (V1, VR3, SCR, DT, FA, SEL…): definen columnas (G18 §3.2). */
export const VISIT_ID_TOKEN = /^(V|VR)\d+$|^(SCR|DT|FA|SEL|ET|FU|EOS|EOT|VNP|VF|VME\d*|VDT)$/i

/**
 * Fichas de TIEMPO (S12, W3, D-14): nunca definen columnas cuando hay fila
 * de ids; son `timing` proyectado por x (G18 §3.2).
 */
export const TIME_TOKEN = /^(S|W)\d+$|^D[+-]?\d+$/i

/**
 * Cuenta las fichas de una banda por rol (G18 §3.2). La banda con más IDS es
 * el encabezado; el tiempo solo es candidato cuando ninguna banda tiene ids.
 */
export function countByRole(tokens: string[]): { ids: number; times: number } {
  let ids = 0
  let times = 0
  for (const t of tokens) {
    if (VISIT_ID_TOKEN.test(t)) ids++
    else if (TIME_TOKEN.test(t)) times++
  }
  return { ids, times }
}

/**
 * Marcas de celda que pueden aparecer en la capa de texto (K1, G12): la «X»
 * del generador y los glifos de los cronogramas reales (✔ √ ○ ■ + …). UN
 * solo conjunto compartido por locate y grid: si uno reconociera una marca
 * que el otro no, una tabla localizada se leería sin sus marcas (o una no
 * localizada escondería un cronograma). Un glifo FUERA del conjunto no
 * descarta la tabla: la racha se conserva y sale `failed`/`no_marks`.
 */
export const MARK_STRINGS = new Set([
  'x', 'X', '✓', '✔', '√', '●', '•', '○', '◯', '■', '□', '✗', '+',
])

/** Una columna sin número en el encabezado numérico (se normaliza a "—"). */
export const DASH_TOKEN = '—'

const NUMERIC_TOKEN_RE = /^(\d{1,3}|[-–—])$/

/** Mínimo de enteros para que la fila cuente como encabezado (con etiqueta). */
const MIN_NUMERIC_COLUMNS = 3
/** Tolerancia de techo de caja para considerar dos fichas de la misma línea (pt). */
const SAME_LINE_TOLERANCE = 1.5
/**
 * Ventana vertical (pt) alrededor de la línea de fichas donde se busca la
 * etiqueta. También es la tolerancia con la que el techo de una región de
 * grilla cubre el bloque completo de su encabezado (G18 §1).
 */
export const LABEL_WINDOW = 9
/** Separación x mínima entre fichas distintas (pt): menos es un solape, no dos columnas. */
const MIN_TOKEN_GAP = 1

/** Letra de ficha partida: prefijo alfabético corto ('V', 'S', 'SCR'…), sin dígitos ni espacios. */
const LETTER_RE = /^[A-Za-zÀ-ÿ]{1,5}$/
/** Franja vertical donde vive la fila de letras: 2–15 pt SOBRE el techo de los números (pt). */
const LETTERS_ABOVE_MIN = 2
const LETTERS_ABOVE_MAX = 15

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
  /** Techo de caja de la línea de NÚMEROS (comparable con `band.y` de las bandas de texto). */
  y: number
  /** Techo de la envolvente de la tira: la fila de letras si la hay, si no `y`. */
  yTop: number
  /** 'visit' (etiqueta de visita) o 'time' (Día / Semana): la primera gana a la segunda. */
  kind: 'visit' | 'time'
  /** Fila de números en orden x: enteros y guiones (cada una con su caja propia). */
  tokens: TextItem[]
  /** Fila de letras (prefijos de la ficha partida) en orden x, alineadas en x con su número; [] si la ficha no está partida. */
  letters: TextItem[]
  /** Ficha por columna: prefijo + número ('V1'), número ('12') o '—' (columna sin número). */
  chips: string[]
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
 * TODAS las candidatas de tira de encabezado numérico de una página (P2c):
 * cada fila etiquetada de enteros crecientes con guiones es una tira, con
 * la ficha PARTIDA en dos filas (prefijo arriba, número abajo) compuesta en
 * `chips`. SIN el filtro visitOnly: el discriminador de regiones de G18 §4
 * (grid) necesita ver la tira de eje temporal de una tabla apilada debajo
 * aunque haya tira de visitas arriba — filtrarla aquí la haría invisible
 * al corte por marcas. Orden: de arriba a abajo. Determinista y puro.
 */
export function findNumericHeaderCandidates(items: TextItem[]): NumericHeader[] {
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

  const candidates: NumericHeader[] = []
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

    // Fila de letras de la ficha partida: prefijos cortos en la franja
    // 2–15 pt sobre el techo de los números, alcanzando la zona de fichas
    // (la etiqueta de fila vive a la izquierda) y alineados en x con su
    // número. Las bandas agrupadas («Selección») están más arriba y no
    // entran; las letras de OTRA tira están fuera de la franja.
    const letters = items
      .filter((i) => {
        const s = i.str.trim()
        if (s.length === 0 || !LETTER_RE.test(s) || i.rotated || i.fontSize < 4) return false
        if (i.bbox[2] <= firstX - 4) return false
        return i.bbox[1] >= top + LETTERS_ABOVE_MIN && i.bbox[3] <= top + LETTERS_ABOVE_MAX
      })
      .sort((a, b) => a.bbox[0] - b.bbox[0])
      .filter((l) => row.some((t) => t.bbox[0] < l.bbox[2] && t.bbox[2] > l.bbox[0]))

    // Ficha compuesta con el TEXTO IMPRESO (el guion queda tal como salió:
    // la normalización a '—' es decisión del llamador — locate la aplica a
    // la firma, grid conserva el texto crudo de la columna).
    const chips = row.map((t) => {
      const letter = letters.find((l) => l.bbox[0] < t.bbox[2] && l.bbox[2] > l.bbox[0])
      return letter ? `${letter.str.trim()}${t.str.trim()}` : t.str.trim()
    })
    const yTop = letters.length > 0 ? Math.max(top, ...letters.map((l) => l.bbox[3])) : top
    candidates.push({ y: top, yTop, kind, tokens: row, letters, chips, labelItems, integers })
  }

  return candidates.sort((a, b) => b.yTop - a.yTop)
}

/**
 * Las tiras de encabezado de la página SIN las de eje temporal cuando hay
 * tira de visitas: la banda «Día»/«Semana» bajo una tira de visitas es
 * estructura de esa grilla, no una tira propia. Comportamiento previo a
 * G18 §4 (locate firma la página con esto); grid corta regiones sobre las
 * candidatas completas.
 */
export function findNumericHeaders(items: TextItem[]): NumericHeader[] {
  const candidates = findNumericHeaderCandidates(items)
  const visitOnly = candidates.some((c) => c.kind === 'visit')
  return visitOnly ? candidates.filter((c) => c.kind === 'visit') : candidates
}

/**
 * La MEJOR tira de la página (una): prioridad de etiqueta de visita sobre
 * eje temporal; a igualdad, la de más arriba. Compatibilidad con locate/grid
 * mientras grid pasa a leer tiras (P2c C1b).
 */
export function findNumericHeader(items: TextItem[]): NumericHeader | null {
  const strips = findNumericHeaders(items)
  if (strips.length === 0) return null
  return strips.find((s) => s.kind === 'visit') ?? strips[0]!
}
