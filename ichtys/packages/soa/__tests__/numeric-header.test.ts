/**
 * P2b (a) — encabezado numérico sin prefijo.
 *
 * Medición privada sobre protocolos reales: el encabezado de visitas es una
 * fila con ETIQUETA ("Número de visita") seguida de ENTEROS sin prefijo
 * (1, 2, 3 … 16) donde un guion es una columna sin número, repetida en cada
 * página. El detector solo reconocía fichas con prefijo (V#, S#, Semana…) y
 * el protocolo más difícil daba 0 columnas.
 *
 * Geometría SINTÉTICA en memoria (los fixtures no se tocan) con la estructura
 * del F6 que arma Grok: páginas apaisadas, banda de períodos agrupados sobre
 * el encabezado, tira de comentarios a la derecha, 2–6 filas por página.
 *
 * Guardas negativas: una fila de enteros SIN etiqueta es dato, no
 * encabezado; una fila "Día" no le quita el encabezado a las fichas con
 * prefijo ni a la fila "Número de visita".
 */
import { describe, expect, it } from 'vitest'
import { locateSchedule, readGrid } from '../index'
import type { PageGeom, RawTable, RuleLine, TextItem } from '../types'

const PAGE_W = 842
const PAGE_H = 595
const LABEL_X0 = 22
const COL_X0 = 170
const COL_W = 34
const ROW_H = 18
const HEADER_TOP = 520
const HEADER_BOTTOM = 498

/** Ítem de texto: la caja mide el tamaño de fuente de alto (convención del generador). */
function text(page: number, str: string, x0: number, top: number, fontSize = 6): TextItem {
  const width = Math.max(str.length * fontSize * 0.55, 2)
  return { page, str, bbox: [x0, top - fontSize, x0 + width, top], fontSize, rotated: false }
}

/** Ítem centrado en x. */
function centered(page: number, str: string, cx: number, top: number, fontSize = 6): TextItem {
  const width = Math.max(str.length * fontSize * 0.55, 2)
  return text(page, str, cx - width / 2, top, fontSize)
}

interface HeaderSpec {
  /** Etiqueta de la fila (en una línea) o null si la fila no lleva etiqueta. */
  label: string | null
  /** Fichas por columna: entero, guion (null) o una ficha con prefijo. */
  values: Array<number | null | string>
}

interface DocSpec {
  header: HeaderSpec
  /** Filas por página: 2–6 como el protocolo real. */
  rowsPerPage: number[]
  /** Fila de eje temporal bajo el encabezado ("Día" 1, 8, 15…), con su etiqueta. */
  timeRow?: { label: string; values: number[] }
  /** Imprime "Comentarios" sobre la tira (por defecto sí). En la ruta con prefijo ese texto entra como columna: comportamiento previo a P2b, fuera de alcance. */
  commentsHeader?: boolean
}

function build(spec: DocSpec): { pages: PageGeom[]; marks: number } {
  const columns = spec.header.values.length
  const stripX0 = COL_X0 + columns * COL_W
  const stripX1 = stripX0 + 54
  let marks = 0
  const pages = spec.rowsPerPage.map((nRows, p): PageGeom => {
    const page = p + 1
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
        if (c % nRows === r || (c * 2 + 1) % nRows === r) {
          items.push(centered(page, 'X', COL_X0 + c * COL_W + COL_W / 2, rowTop - 5, 7))
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
const NUMERIC_VALUES: Array<number | null> = [1, 2, 3, null, 4, 5, 6, 7, 8, null, 9, 10, 11, 12, 13, 14, 15, 16]

const tableOf = (pages: PageGeom[]): RawTable => readGrid(pages, locateSchedule(pages)).tables[0]!

describe('P2b (a) — encabezado numérico: etiqueta de fila + enteros con guiones', () => {
  const { pages, marks } = build({
    header: { label: 'Número de visita', values: NUMERIC_VALUES },
    rowsPerPage: [4, 2, 6, 3],
  })

  it('el localizador agrupa las 4 páginas en una tabla y reporta la firma numérica', () => {
    const location = locateSchedule(pages)
    expect(location.tables).toHaveLength(1)
    expect(location.tables[0]!.pages).toEqual([1, 2, 3, 4])
    // La firma del encabezado trae las fichas (enteros y guiones), no queda vacía.
    expect(location.tables[0]!.headerSignature).toEqual(expect.arrayContaining(['1', '16', '—']))
  })

  it('lee una columna por entero y por guion, en orden, sin convertir la etiqueta en columna', () => {
    const table = tableOf(pages)
    expect(table.outcome).not.toBe('failed')
    expect(table.columns).toHaveLength(NUMERIC_VALUES.length)
    expect(table.columns.map((c) => c.headerText)).toEqual(
      NUMERIC_VALUES.map((v) => (v === null ? '-' : String(v))),
    )
    // Orden de lectura: los centros crecen y la tira de comentarios no es columna.
    const centers = table.columns.map((c) => c.xCenter)
    expect(centers).toEqual([...centers].sort((a, b) => a - b))
    expect(table.columns.every((c) => c.page === 1)).toBe(true)
  })

  it('cada marca tiene dueño: celdas = marcas dibujadas y G3 en pass; las columnas sin número reciben sus marcas', () => {
    const table = tableOf(pages)
    expect(table.cells.filter((c) => c.kind === 'mark')).toHaveLength(marks)
    expect(table.checks.find((c) => c.id === 'G3')?.pass).toBe(true)
    // Los dos guiones son columnas distintas y ambas reciben marcas.
    for (const dashIndex of [3, 9]) {
      expect(table.cells.some((c) => c.colIndex === dashIndex), `columna ${dashIndex}`).toBe(true)
    }
  })

  it('el encabezado repetido no duplica columnas y las filas son las del cuerpo (2–6 por página)', () => {
    const table = tableOf(pages)
    const perPage = [4, 2, 6, 3]
    for (const [i, n] of perPage.entries()) {
      expect(table.rows.filter((r) => r.page === i + 1)).toHaveLength(n)
    }
  })
})

describe('P2b (a) — guardas negativas', () => {
  it('una fila de enteros SIN etiqueta no es encabezado: la tabla no se lee como grilla', () => {
    const { pages } = build({
      header: { label: null, values: NUMERIC_VALUES },
      rowsPerPage: [4, 3],
    })
    const table = tableOf(pages)
    expect(table.columns).toHaveLength(0)
    expect(table.outcome).toBe('failed')
  })

  it('una etiqueta que no es de encabezado ("Peso (kg)") tampoco habilita la fila', () => {
    const { pages } = build({
      header: { label: 'Peso (kg)', values: NUMERIC_VALUES },
      rowsPerPage: [4, 3],
    })
    expect(tableOf(pages).columns).toHaveLength(0)
  })

  it('una fila "Día" con enteros bajo fichas con prefijo no le quita el encabezado', () => {
    const prefixed = Array.from({ length: 6 }, (_, i) => `V${i + 1}`)
    const { pages } = build({
      header: { label: null, values: prefixed },
      rowsPerPage: [3, 3],
      timeRow: { label: 'Día', values: [1, 8, 15, 22, 29, 36] },
      commentsHeader: false,
    })
    const table = tableOf(pages)
    expect(table.columns.map((c) => c.headerText)).toEqual(prefixed)
  })

  it('"Número de visita" gana a "Día" aunque la fila de días vaya más arriba en la página', () => {
    // El encabezado de visitas es la fila "Número de visita"; la de días está
    // debajo (la banda del tiempo) y tiene enteros crecientes también.
    const values = [1, 2, 3, 4, 5, 6]
    const { pages } = build({
      header: { label: 'Número de visita', values },
      rowsPerPage: [3, 3],
      timeRow: { label: 'Día', values: [1, 8, 15, 22, 29, 36] },
    })
    const table = tableOf(pages)
    expect(table.columns.map((c) => c.headerText)).toEqual(values.map(String))
  })

  it('una fila "Día" sola, con enteros crecientes y sin fichas con prefijo, sí sirve de encabezado', () => {
    const { pages } = build({
      header: { label: 'Día', values: [1, 8, 15, 22, 29] },
      rowsPerPage: [4, 4],
    })
    expect(tableOf(pages).columns.map((c) => c.headerText)).toEqual(['1', '8', '15', '22', '29'])
  })

  it('enteros que no crecen de izquierda a derecha no son encabezado, aunque tengan etiqueta', () => {
    const { pages } = build({
      header: { label: 'Número de visita', values: [3, 1, 2, 5, 4] },
      rowsPerPage: [4, 4],
    })
    expect(tableOf(pages).columns).toHaveLength(0)
  })
})
