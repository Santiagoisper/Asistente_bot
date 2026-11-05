/**
 * G22 §3 C3 — la figura no se decide por el hueco entre fichas. El hueco
 * real (~13 pt) es casi el de una fila de semanas (~11 pt), así que una
 * mediana < 10 pt no la separa y, al revés, tiraría un encabezado real.
 *
 * La página trae encabezado y 0 marcas. La siguiente trae encabezado propio
 * y marcas. No se unen. La figura queda como tabla failed/no_marks, visible.
 * Comparten subtítulo vacío, como en el protocolo donde la figura antecede
 * a la grilla.
 */
import { describe, expect, it } from 'vitest'
import type { PageGeom, RuleLine, TextItem } from '../types'
import { locateSchedule, readGrid } from '../index'
import { centered, text } from './synthetic-pages'

/** 17 fichas a 5 pt, 18,4 pt entre orígenes. El hueco de caja queda > 10 pt. */
function figurePage(page: number): PageGeom {
  const items: TextItem[] = []
  const rules: RuleLine[] = []
  let x = 60
  for (let k = 1; k <= 17; k++) {
    items.push(text(page, `S${k}`, x, 300, 5))
    x += 18.4
  }
  for (const y of [330, 280]) rules.push({ page, x0: 40, y0: y, x1: 420, y1: y })
  for (const vx of [40, 420]) rules.push({ page, x0: vx, y0: 280, x1: vx, y1: 330 })
  return { page, width: 842, height: 595, rotate: 0, items, rules }
}

/** Página de TABLA legítima: fichas V bien separadas por columnas + marcas. */
function tablePage(page: number): PageGeom {
  const items: TextItem[] = []
  const rules: RuleLine[] = []
  for (let c = 0; c < 12; c++) {
    items.push(centered(page, `V${c + 1}`, 170 + c * 34 + 17, 506))
  }
  const rowTops = [440, 422, 404]
  rowTops.forEach((top, r) => {
    items.push(text(page, `Procedimiento ${r + 1}`, 22, top, 6))
    for (const c of [r * 2, r * 2 + 4, r * 2 + 8].filter((v) => v < 12)) {
      items.push(centered(page, 'X', 170 + c * 34 + 17, top - 3, 7))
    }
  })
  for (const y of [515, 494, 442, 424, 406, 388]) {
    rules.push({ page, x0: 22, y0: y, x1: 170 + 12 * 34, y1: y })
  }
  for (let k = 0; k <= 12; k++) rules.push({ page, x0: 170 + k * 34, y0: 388, x1: 170 + k * 34, y1: 515 })
  rules.push({ page, x0: 22, y0: 388, x1: 22, y1: 515 })
  return { page, width: 842, height: 595, rotate: 0, items, rules }
}

describe('G22 §3 C3 — la figura no se une a la tabla que sigue', () => {
  const pages = [figurePage(1), tablePage(2)]

  it('la figura queda failed/no_marks y la tabla sigue en su página', () => {
    const location = locateSchedule(pages)
    expect(location.tables.map((table) => table.pages)).toEqual([[1], [2]])
    expect(location.rejected.find((item) => item.page === 1)).toBeUndefined()
    const schedule = readGrid(pages, location)
    const figure = schedule.tables.find((table) => table.pages.includes(1))!
    const grid = schedule.tables.find((table) => table.pages.includes(2))!
    expect(figure.pages).toEqual([1])
    expect(figure.outcome).toBe('failed')
    expect(figure.reasons).toContain('no_marks')
    expect(grid.pages).toEqual([2])
    expect(grid.reasons).not.toContain('no_marks')
  })
})
