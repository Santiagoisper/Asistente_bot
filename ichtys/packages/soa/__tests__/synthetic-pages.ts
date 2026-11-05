/**
 * Geometría SINTÉTICA en memoria para los tests de P2b (los fixtures no se
 * tocan): páginas apaisadas con la estructura del F6 de Grok — banda de
 * períodos agrupados sobre el encabezado, tira de comentarios a la derecha,
 * 2–6 filas por página, encabezado repetido en cada página.
 */
import type { PageGeom, RuleLine, TextItem } from '../types'

export const PAGE_W = 842
export const PAGE_H = 595
export const LABEL_X0 = 22
export const COL_X0 = 170
export const COL_W = 34
export const ROW_H = 18
export const HEADER_TOP = 520
export const HEADER_BOTTOM = 498

/** Ítem de texto: la caja mide el tamaño de fuente de alto (convención del generador). */
export function text(page: number, str: string, x0: number, top: number, fontSize = 6): TextItem {
  const width = Math.max(str.length * fontSize * 0.55, 2)
  return { page, str, bbox: [x0, top - fontSize, x0 + width, top], fontSize, rotated: false }
}

/** Ítem centrado en x. */
export function centered(page: number, str: string, cx: number, top: number, fontSize = 6): TextItem {
  const width = Math.max(str.length * fontSize * 0.55, 2)
  return text(page, str, cx - width / 2, top, fontSize)
}

export interface HeaderSpec {
  /** Etiqueta de la fila (en una línea) o null si la fila no lleva etiqueta. */
  label: string | null
  /** Fichas por columna: entero, guion (null) o una ficha con prefijo. */
  values: Array<number | null | string>
}

export interface DocSpec {
  header: HeaderSpec
  /** Filas por página: 2–6 como el protocolo real. */
  rowsPerPage: number[]
  /** Fila de eje temporal bajo el encabezado ("Día" 1, 8, 15…), con su etiqueta. */
  timeRow?: { label: string; values: number[] }
  /** Imprime "Comentarios" sobre la tira (por defecto sí). En la ruta con prefijo ese texto entra como columna: comportamiento previo a P2b, fuera de alcance. */
  commentsHeader?: boolean
  /** Número de la primera página del bloque (por defecto 1). */
  firstPage?: number
  /** Dibuja las marcas "X" (por defecto sí). Sin marcas la grilla es solo estructura y encabezado. */
  withMarks?: boolean
  /** Glifo de las marcas (por defecto "X"): K1 prueba glifos dentro y fuera del conjunto reconocido. */
  markGlyph?: string
}

export function build(spec: DocSpec): { pages: PageGeom[]; marks: number } {
  const columns = spec.header.values.length
  const stripX0 = COL_X0 + columns * COL_W
  const stripX1 = stripX0 + 54
  let marks = 0
  const pages = spec.rowsPerPage.map((nRows, p): PageGeom => {
    const page = (spec.firstPage ?? 1) + p
    const items: TextItem[] = []
    const rules: RuleLine[] = []
    items.push(text(page, `Página ${page}`, 24, 584, 8))
    items.push(text(page, 'Cronograma de actividades', 22, 566, 8))
    items.push(text(page, 'Fase de tratamiento', 22, 552, 7))

    // Banda de períodos agrupados sobre el encabezado.
    const third = Math.floor(columns / 3)
    items.push(centered(page, 'Selección', COL_X0 + (third * COL_W) / 2, 534))
    items.push(centered(page, 'Tratamiento', COL_X0 + third * COL_W + ((columns - third) * COL_W) / 2, 534))

    // Encabezado repetido en cada página.
    if (spec.header.label !== null) items.push(text(page, spec.header.label, LABEL_X0 + 2, 512))
    spec.header.values.forEach((v, c) => {
      const cx = COL_X0 + c * COL_W + COL_W / 2
      const str = v === null ? '-' : String(v)
      items.push(centered(page, str, cx, 512))
    })
    if (spec.commentsHeader !== false) {
      items.push(centered(page, 'Comentarios', (stripX0 + stripX1) / 2, 512))
    }

    // Filas del cuerpo; cada columna recibe al menos una marca por página.
    let rowTop = HEADER_BOTTOM
    let timeRowBottom = HEADER_BOTTOM
    if (spec.timeRow) {
      items.push(text(page, spec.timeRow.label, LABEL_X0 + 2, rowTop - 6))
      spec.timeRow.values.forEach((v, c) => {
        items.push(centered(page, String(v), COL_X0 + c * COL_W + COL_W / 2, rowTop - 6))
      })
      timeRowBottom = rowTop - ROW_H
      rules.push({ page, x0: LABEL_X0, y0: timeRowBottom, x1: stripX1, y1: timeRowBottom })
      rowTop = timeRowBottom
    }
    for (let r = 0; r < nRows; r++) {
      items.push(text(page, `Procedimiento ${page}-${r + 1}`, LABEL_X0 + 2, rowTop - 6))
      for (let c = 0; c < columns; c++) {
        if (spec.withMarks !== false && (c % nRows === r || (c * 2 + 1) % nRows === r)) {
          items.push(centered(page, spec.markGlyph ?? 'X', COL_X0 + c * COL_W + COL_W / 2, rowTop - 5, 7))
          marks++
        }
      }
      if (r % 2 === 0) items.push(text(page, 'ver nota', stripX0 + 2, rowTop - 6))
      rowTop -= ROW_H
      rules.push({ page, x0: LABEL_X0, y0: rowTop, x1: stripX1, y1: rowTop })
    }

    // Bordes: horizontales de los intervalos del encabezado y verticales por columna.
    const bottom = rowTop
    for (const y of [HEADER_TOP + 14, HEADER_TOP, HEADER_BOTTOM]) {
      rules.push({ page, x0: LABEL_X0, y0: y, x1: stripX1, y1: y })
    }
    const xs = [LABEL_X0, ...Array.from({ length: columns + 1 }, (_, k) => COL_X0 + k * COL_W), stripX1]
    for (const x of xs) rules.push({ page, x0: x, y0: bottom, x1: x, y1: HEADER_TOP + 14 })

    return { page, width: PAGE_W, height: PAGE_H, rotate: 0, items, rules }
  })
  return { pages, marks }
}

/** 1..16 con dos guiones como columnas sin número (18 columnas). */
export const NUMERIC_VALUES: Array<number | null> = [1, 2, 3, null, 4, 5, 6, 7, 8, null, 9, 10, 11, 12, 13, 14, 15, 16]

/** Página en blanco (sin texto ni bordes): separa los bloques para que no se fusionen en una racha. */
export function blankPage(page: number): PageGeom {
  return { page, width: PAGE_W, height: PAGE_H, rotate: 0, items: [], rules: [] }
}

// ---------------------------------------------------------------------------
// P2c — tiras de encabezado apiladas con la ficha PARTIDA en dos filas
// (estructura verificada del protocolo real de 46 columnas): en cada página
// hay N tiras; cada tira tiene una fila de LETRAS (prefijo de la ficha) y,
// unos puntos más abajo, la fila de NÚMEROS alineada en x; las filas de
// datos cuelgan del encabezado de SU tira y las tiras se repiten en las
// páginas siguientes.
// ---------------------------------------------------------------------------

/** Separación vertical entre la fila de letras y la de números (pt). */
export const SPLIT_CHIP_GAP = 9
/** Alto reservado a cada tira: encabezado (2 filas) + sus filas de datos. */
const STRIP_PITCH = 110

/** Parte una ficha con prefijo ('V1') en prefijo y número; sin prefijo, solo número. */
function splitChip(chip: string): { prefix: string | null; number: string } {
  const m = chip.match(/^([^\d]+?)(\d+)$/)
  return m ? { prefix: m[1]!, number: m[2]! } : { prefix: null, number: chip }
}

export interface StripSpec {
  /** Etiqueta de fila a la izquierda de la fila de números de la tira. */
  label: string | null
  /** Fichas: 'V1' (partida prefijo/número), '12' (número solo) o null (guion). */
  chips: Array<string | null>
}

export interface StripsDocSpec {
  strips: StripSpec[]
  /** Filas de datos POR TIRA en cada página. */
  rowsPerPage: number[]
  /** Banda de eje temporal bajo el encabezado de la PRIMERA tira ("Día" 1, 8, 15…). */
  timeRow?: { label: string; values: number[] }
  firstPage?: number
  withMarks?: boolean
  markGlyph?: string
}

/**
 * Documento con tiras apiladas: la tira k ocupa su franja vertical propia
 * (encabezado de dos filas + filas de datos); los bordes V se trazan por
 * columna dentro de la franja de cada tira.
 */
export function buildStrips(spec: StripsDocSpec): { pages: PageGeom[]; marks: number } {
  let marks = 0
  const pages = spec.rowsPerPage.map((nRows, p): PageGeom => {
    const page = (spec.firstPage ?? 1) + p
    const items: TextItem[] = []
    const rules: RuleLine[] = []
    items.push(text(page, `Página ${page}`, 24, 584, 8))
    items.push(text(page, 'Cronograma de actividades', 22, 566, 8))

    spec.strips.forEach((strip, s) => {
      const columns = strip.chips.length
      const lettersTop = HEADER_TOP - 8 - s * STRIP_PITCH
      const numbersTop = lettersTop - SPLIT_CHIP_GAP
      // Etiqueta a la izquierda de la fila de números.
      if (strip.label !== null) items.push(text(page, strip.label, LABEL_X0 + 2, numbersTop))
      strip.chips.forEach((chip, c) => {
        const cx = COL_X0 + c * COL_W + COL_W / 2
        const { prefix, number } = chip === null ? { prefix: null, number: '-' } : splitChip(chip)
        if (prefix !== null) items.push(centered(page, prefix, cx, lettersTop))
        items.push(centered(page, number, cx, numbersTop))
      })

      let rowTop = numbersTop - 12
      if (s === 0 && spec.timeRow) {
        items.push(text(page, spec.timeRow.label, LABEL_X0 + 2, rowTop - 6))
        spec.timeRow.values.forEach((v, c) => {
          if (c < columns) items.push(centered(page, String(v), COL_X0 + c * COL_W + COL_W / 2, rowTop - 6))
        })
        rules.push({ page, x0: LABEL_X0, y0: rowTop - ROW_H, x1: COL_X0 + columns * COL_W, y1: rowTop - ROW_H })
        rowTop -= ROW_H
      }
      for (let r = 0; r < nRows; r++) {
        items.push(text(page, `Procedimiento ${page}-${s + 1}-${r + 1}`, LABEL_X0 + 2, rowTop - 6))
        for (let c = 0; c < columns; c++) {
          if (spec.withMarks !== false && (c % nRows === r || (c * 2 + 1) % nRows === r)) {
            items.push(centered(page, spec.markGlyph ?? 'X', COL_X0 + c * COL_W + COL_W / 2, rowTop - 5, 7))
            marks++
          }
        }
        rowTop -= ROW_H
        rules.push({ page, x0: LABEL_X0, y0: rowTop, x1: COL_X0 + columns * COL_W, y1: rowTop })
      }

      const bottom = rowTop
      for (const y of [lettersTop + 6, numbersTop + 3, numbersTop - 6]) {
        rules.push({ page, x0: LABEL_X0, y0: y, x1: COL_X0 + columns * COL_W, y1: y })
      }
      const xs = [LABEL_X0, ...Array.from({ length: columns + 1 }, (_, k) => COL_X0 + k * COL_W)]
      for (const x of xs) rules.push({ page, x0: x, y0: bottom, x1: x, y1: lettersTop + 6 })
    })

    return { page, width: PAGE_W, height: PAGE_H, rotate: 0, items, rules }
  })
  return { pages, marks }
}
