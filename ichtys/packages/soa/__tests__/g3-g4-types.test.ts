/**
 * P2b (c) — G3 y G4 explican POR TIPO de falta.
 *
 * Medición privada: en dos protocolos reales la tabla sale `partial` con
 * ~55 % de las marcas esperadas y G3/G4 avisando, pero el detalle solo daba
 * "asignadas/presentes" por página: no decía POR QUÉ se pierden. Ahora cada
 * marca sin dueño y cada fila con contenido perdido lleva un código de tipo
 * y un conteo. Solo códigos y conteos (S8): el detalle nunca trae texto del
 * documento.
 *
 * Tipos de G3 (una marca presente que no llegó a ser celda):
 *   sin_columna      — su x no cae en ninguna banda de columna de la página.
 *   banda_sin_ficha  — cae en una banda, pero esa banda no tiene ficha de
 *                      encabezado (tira de comentarios, columna de etiquetas).
 *   sin_fila         — la columna es válida pero ninguna fila contiene su y.
 * Tipos de G4 (fila sin celdas con texto visible en la zona de columnas):
 *   texto_en_columna        — el texto cae dentro de las columnas con ficha.
 *   texto_fuera_de_columnas — cae fuera (a la derecha: tira de comentarios).
 */
import { describe, expect, it } from 'vitest'
import { locateSchedule, readGrid } from '../index'
import type { PageGeom, RawTable, TextItem } from '../types'
import {
  build,
  centered,
  COL_W,
  COL_X0,
  HEADER_BOTTOM,
  NUMERIC_VALUES,
  ROW_H,
  text,
} from './synthetic-pages'

const tableOf = (pages: PageGeom[]): RawTable => readGrid(pages, locateSchedule(pages)).tables[0]!
const check = (table: RawTable, id: string) => table.checks.find((c) => c.id === id)!

const COLUMNS = NUMERIC_VALUES.length
const STRIP_X0 = COL_X0 + COLUMNS * COL_W

/** Techo de caja de la fila `r` (0 = primera del cuerpo). */
const rowTop = (r: number): number => HEADER_BOTTOM - r * ROW_H

const doc = () => build({ header: { label: 'Número de visita', values: NUMERIC_VALUES }, rowsPerPage: [4, 3] })

function mapPage(pages: PageGeom[], page: number, fn: (items: TextItem[]) => TextItem[]): PageGeom[] {
  return pages.map((p) => (p.page === page ? { ...p, items: fn(p.items) } : p))
}

const mark = (page: number, cx: number, top: number): TextItem => centered(page, 'X', cx, top, 7)

/** Quita las marcas de la fila `r` de la página. */
function clearRowMarks(items: TextItem[], r: number): TextItem[] {
  const y0 = rowTop(r) - ROW_H
  const y1 = rowTop(r)
  return items.filter((i) => {
    if (i.str.trim() !== 'X') return true
    const cy = (i.bbox[1] + i.bbox[3]) / 2
    return !(cy >= y0 && cy <= y1)
  })
}

/** "pN asignadas/esperadas [tipos]" → números, para chequear la invariante. */
function parseG3(detail: string, page: number): { assigned: number; expected: number; types: Record<string, number> } {
  const m = new RegExp(`p${page} (\\d+)/(\\d+)(?: \\[([^\\]]*)\\])?`).exec(detail)
  expect(m, `detalle G3 sin p${page}: ${detail}`).not.toBeNull()
  const types: Record<string, number> = {}
  for (const part of (m![3] ?? '').split(' ').filter(Boolean)) {
    const [name, count] = part.split(':')
    types[name!] = Number(count)
  }
  return { assigned: Number(m![1]), expected: Number(m![2]), types }
}

describe('P2b (c) — G3 por tipo de marca perdida', () => {
  it('documento sano: G3 pasa y su detalle no cambia', () => {
    const table = tableOf(doc().pages)
    expect(check(table, 'G3').pass).toBe(true)
    expect(check(table, 'G3').detail).toMatch(/^marcas con dueño en \d+ pág\.$/)
  })

  it('marca a la izquierda de toda banda → sin_columna', () => {
    const { pages } = doc()
    const mutated = mapPage(pages, 1, (items) => [...items, mark(1, 10, rowTop(0) - 5)])
    const table = tableOf(mutated)
    expect(table.outcome).toBe('partial')
    expect(table.reasons).toContain('validation_failed:G3')
    const g3 = parseG3(check(table, 'G3').detail, 1)
    expect(g3.types).toEqual({ sin_columna: 1 })
    expect(g3.expected - g3.assigned).toBe(1)
  })

  it('marca en la tira de comentarios (banda sin ficha) → banda_sin_ficha', () => {
    const { pages } = doc()
    const mutated = mapPage(pages, 2, (items) => [...items, mark(2, STRIP_X0 + 27, rowTop(1) - 5)])
    const table = tableOf(mutated)
    expect(table.reasons).toContain('validation_failed:G3')
    const g3 = parseG3(check(table, 'G3').detail, 2)
    expect(g3.types).toEqual({ banda_sin_ficha: 1 })
    expect(g3.expected - g3.assigned).toBe(1)
  })

  it('marca en columna válida pero por debajo de la última fila → sin_fila', () => {
    const { pages } = doc()
    const below = rowTop(3) - 14 // la página 2 tiene 3 filas: nada contiene esta y
    const mutated = mapPage(pages, 2, (items) => [...items, mark(2, COL_X0 + 2 * COL_W + COL_W / 2, below)])
    const table = tableOf(mutated)
    expect(table.reasons).toContain('validation_failed:G3')
    const g3 = parseG3(check(table, 'G3').detail, 2)
    expect(g3.types).toEqual({ sin_fila: 1 })
    expect(g3.expected - g3.assigned).toBe(1)
  })

  it('varios tipos en la misma página se listan con su conteo y suman exactamente las marcas perdidas', () => {
    const { pages } = doc()
    const mutated = mapPage(pages, 1, (items) => [
      ...items,
      mark(1, 10, rowTop(0) - 5),
      mark(1, 12, rowTop(1) - 5),
      mark(1, STRIP_X0 + 27, rowTop(2) - 5),
      mark(1, COL_X0 + 5 * COL_W + COL_W / 2, rowTop(4) - 14),
    ])
    const g3 = parseG3(check(tableOf(mutated), 'G3').detail, 1)
    expect(g3.types).toEqual({ sin_columna: 2, banda_sin_ficha: 1, sin_fila: 1 })
    expect(g3.expected - g3.assigned).toBe(4)
    // Orden estable del detalle: sin_columna, banda_sin_ficha, sin_fila.
    expect(check(tableOf(mutated), 'G3').detail).toContain('[sin_columna:2 banda_sin_ficha:1 sin_fila:1]')
  })

  it('S8: el detalle trae solo códigos y conteos, nunca texto del documento', () => {
    const { pages } = doc()
    const mutated = mapPage(pages, 1, (items) => [...items, mark(1, 10, rowTop(0) - 5)])
    const detail = check(tableOf(mutated), 'G3').detail
    for (const word of ['Procedimiento', 'Número', 'visita', 'ver nota', 'Comentarios']) {
      expect(detail).not.toContain(word)
    }
  })
})

describe('P2b (c) — G4 por tipo de contenido perdido', () => {
  it('documento sano: G4 pasa y su detalle no cambia', () => {
    const table = tableOf(doc().pages)
    expect(check(table, 'G4').pass).toBe(true)
    expect(check(table, 'G4').detail).toMatch(/^filas \d+, vacías sin contenido perdido$/)
  })

  it('fila sin celdas con texto dentro de las columnas → texto_en_columna', () => {
    const { pages } = doc()
    // La fila 1 de la página 1 no tiene texto en la tira: queda solo el valor suelto.
    const mutated = mapPage(pages, 1, (items) => [
      ...clearRowMarks(items, 1),
      text(1, 'zz', COL_X0 + 2 * COL_W + 8, rowTop(1) - 6),
    ])
    const table = tableOf(mutated)
    expect(table.reasons).toContain('validation_failed:G4')
    const detail = check(table, 'G4').detail
    expect(detail).toMatch(/p1·f\d+/)
    expect(detail).toContain('[texto_en_columna:1]')
    expect(detail).not.toContain('zz')
  })

  it('fila sin celdas con texto solo en la tira de comentarios → texto_fuera_de_columnas', () => {
    const { pages } = doc()
    // La fila 0 tiene "ver nota" en la tira: sin marcas, ese es todo su contenido.
    const mutated = mapPage(pages, 1, (items) => clearRowMarks(items, 0))
    const table = tableOf(mutated)
    expect(table.reasons).toContain('validation_failed:G4')
    const detail = check(table, 'G4').detail
    expect(detail).toContain('[texto_fuera_de_columnas:1]')
    expect(detail).not.toContain('ver nota')
  })

  it('S8: el detalle de G4 trae solo códigos y conteos', () => {
    const { pages } = doc()
    const mutated = mapPage(pages, 1, (items) => clearRowMarks(items, 0))
    const detail = check(tableOf(mutated), 'G4').detail
    for (const word of ['Procedimiento', 'ver nota', 'Comentarios']) {
      expect(detail).not.toContain(word)
    }
  })
})
