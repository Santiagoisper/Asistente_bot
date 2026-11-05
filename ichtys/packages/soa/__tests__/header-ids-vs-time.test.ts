/**
 * G18 §3.2 — separar id de visita y tiempo: el encabezado de COLUMNAS sale
 * de la fila de ids de visita; la fila de tiempo (S…, W…, D…) nunca define
 * columnas.
 *
 * Protocolo de 46 columnas (G18 §2, estructura medida en p25): el bloque de
 * encabezado trae la fila de ids de visita PARTIDA en celdas de dos líneas
 * (prefijo ~511, cortas enteras centradas ~506, número ~502) y, ~35 pt
 * abajo, la fila de SEMANAS con fichas S… enteras. VISIT_TOKEN contaba
 * S\d+/W\d+/D\d+ como visitas, así que la banda de semanas (17–21 fichas)
 * le ganaba a la de ids (4–5 cortas por banda) y las columnas salían del
 * TIEMPO, no de las visitas.
 *
 * Excepción necesaria (F5 replica R3): cuando la única fila de fichas es de
 * tiempo (W2, D1…), ESA fila es la línea de ids — el tiempo nunca es id
 * *cuando hay ids* (extensión de K2), pero una tabla identificada por
 * semanas existe y hoy se lee bien.
 */
import { describe, expect, it } from 'vitest'
import type { PageGeom, RuleLine, TextItem } from '../types'
import { locateSchedule, readGrid } from '../index'
import { centered, text } from './synthetic-pages'

const COLS = 12
const COL_X0 = 170
const COL_W = 34
const cx = (c: number) => COL_X0 + c * COL_W + COL_W / 2

/** Página con el bloque de encabezado del protocolo de 46 columnas. */
function r46Page(ids: 'split' | 'timeOnly'): PageGeom {
  const page = 1
  const items: TextItem[] = []
  const rules: RuleLine[] = []
  items.push(text(page, 'Cronograma de actividades', 22, 580, 8))

  if (ids === 'split') {
    // Fila de ids de visita: cortas enteras centradas (cols 0, 5, 6, 11) y
    // largas partidas (prefijo arriba ~511, número abajo ~502, mismo x).
    for (const c of [0, 5, 6, 11]) items.push(centered(page, `V${c + 1}`, cx(c), 506))
    for (const c of [1, 2, 3, 4, 7, 8, 9, 10]) {
      // Partida con prefijo y número ALINEADOS en x (±1 pt, como el real).
      const x0 = cx(c) - 6
      items.push(text(page, 'V', x0, 511, 5))
      items.push(text(page, String(c + 1), x0, 502, 5))
    }
    // Etiqueta del bloque, alineada con la línea del número (~497, medida G18).
    items.push(text(page, 'Visitas', 22, 497, 7))
  } else {
    // Sin fila de ids: la única fila de fichas es de tiempo (F5 / R3).
    for (let c = 0; c < COLS; c++) items.push(centered(page, `W${c + 1}`, cx(c), 506))
    items.push(text(page, 'Visitas', 22, 497, 7))
  }
  // Fila de semanas ~35 pt bajo las visitas.
  for (let c = 0; c < COLS; c++) items.push(centered(page, `S${c + 1}`, cx(c), 471, 5))

  // Filas de datos con marcas.
  const rowTops = [440, 422, 404]
  rowTops.forEach((top, r) => {
    items.push(text(page, `Procedimiento ${r + 1}`, 22, top, 6))
    for (const c of [r * 2, r * 2 + 4, r * 2 + 8].filter((x) => x < COLS)) {
      items.push(centered(page, 'X', cx(c), top - 3, 7))
    }
  })

  // Bordes: horizontales del bloque y las filas; verticales por columna.
  for (const y of [515, 494, 442, 424, 406, 388]) {
    rules.push({ page, x0: 22, y0: y, x1: COL_X0 + COLS * COL_W, y1: y })
  }
  for (let k = 0; k <= COLS; k++) {
    const x = COL_X0 + k * COL_W
    rules.push({ page, x0: x, y0: 388, x1: x, y1: 515 })
  }
  rules.push({ page, x0: 22, y0: 388, x1: 22, y1: 515 })

  return { page, width: 842, height: 595, rotate: 0, items, rules }
}

describe('G18 §3.2 — columnas desde la fila de ids, no del tiempo', () => {
  it('ids partidas en celdas de 2 líneas + fila de semanas: las columnas son las visitas', () => {
    const pages = [r46Page('split')]
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!

    expect(table.columns).toHaveLength(COLS)
    // La ficha partida se compone: prefijo + número ('V 2' tras groupTexts).
    expect(table.columns.map((c) => c.headerText.replace(/\s+/g, ''))).toEqual(
      Array.from({ length: COLS }, (_, i) => `V${i + 1}`),
    )
    expect(table.columns.every((c) => c.headerSource === 'prefixed')).toBe(true)
  })

  it('sin fila de ids, la fila de tiempo ES el encabezado (F5 / R3, no regresión)', () => {
    const pages = [r46Page('timeOnly')]
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!

    expect(table.columns).toHaveLength(COLS)
    expect(table.columns.map((c) => c.headerText)).toEqual(
      Array.from({ length: COLS }, (_, i) => `W${i + 1}`),
    )
  })

  it('la fila de semanas se proyecta como timing por x, sin definir columnas', () => {
    const pages = [r46Page('split')]
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!

    // Las columnas siguen siendo las visitas (B-1)…
    expect(table.columns.map((c) => c.headerText.replace(/\s+/g, ''))).toEqual(
      Array.from({ length: COLS }, (_, i) => `V${i + 1}`),
    )
    // …y cada una lleva su semana como timing (G18 §3.2).
    expect(table.columns.map((c) => c.timingText)).toEqual(
      Array.from({ length: COLS }, (_, i) => `S${i + 1}`),
    )
  })
})
