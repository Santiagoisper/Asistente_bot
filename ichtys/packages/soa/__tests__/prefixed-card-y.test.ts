/**
 * G22 §3 C2: en el camino con prefijo la ficha partida se compone de arriba
 * abajo. Con dos cifras el número empieza a la izquierda del prefijo, y
 * ordenar por x da «12 V». El id tiene que ser V12, nunca «12 V» ni «V 12».
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadPageGeometry, locateSchedule, readGrid } from '../index'
import type { PageGeom, RuleLine, TextItem } from '../types'
import { centered, text } from './synthetic-pages'

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa/', import.meta.url))

const F7_IDS = [
  'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'ET', 'V9', 'V10', 'V11', 'V12',
  'V13', 'FA', 'V14', 'V15', 'V16', 'V17', 'V18', 'VDT', 'V19', 'V20', 'V21', 'V22', 'EOS',
] as const

describe('G22 C2 — ficha partida por fila', () => {
  it('F7 lee V12, nunca 12 V ni V 12', async () => {
    const pdf = new Uint8Array(readFileSync(`${FIXTURES_DIR}F7.pdf`))
    const pages = await loadPageGeometry(pdf)
    const grid = readGrid(pages, locateSchedule(pages)).tables.find((table) => table.pages.includes(3))!
    const headers = grid.columns.map((column) => column.headerText)
    expect(headers).toEqual([...F7_IDS])
    for (const header of headers) {
      expect(header).not.toMatch(/\d+\s*V/)
      expect(header).not.toMatch(/[A-Za-z]\s+\d/)
    }
  })

  it('un número de dos cifras a la izquierda del prefijo se lee de arriba abajo', () => {
    const table = readGrid([shiftedPage()], locateSchedule([shiftedPage()])).tables[0]!
    expect(table.columns.map((column) => column.headerText)).toEqual(['V1', 'V12', 'ET'])
  })
})

/** El «12» empieza 4 pt a la izquierda de la «V». Por x saldría «12 V». */
function shiftedPage(): PageGeom {
  const page = 1
  const cols = 3
  const x0 = 170
  const w = 40
  const cx = (c: number) => x0 + c * w + w / 2
  const items: TextItem[] = [
    text(page, 'Cronograma de actividades', 22, 580, 8),
    centered(page, 'V1', cx(0), 506),
    text(page, 'V', cx(1) - 4, 511, 7),
    text(page, '12', cx(1) - 8, 502, 9),
    centered(page, 'ET', cx(2), 506),
    text(page, 'Visitas', 22, 502, 7),
  ]
  for (let c = 0; c < cols; c++) items.push(centered(page, `S${c + 1}`, cx(c), 471, 5))
  items.push(text(page, 'Procedimiento', 22, 440, 6))
  for (const c of [0, 1, 2]) items.push(centered(page, 'X', cx(c), 437, 7))
  const rules: RuleLine[] = []
  for (const y of [515, 494, 442, 424]) {
    rules.push({ page, x0: 22, y0: y, x1: x0 + cols * w, y1: y })
  }
  for (let k = 0; k <= cols; k++) {
    rules.push({ page, x0: x0 + k * w, y0: 424, x1: x0 + k * w, y1: 515 })
  }
  return { page, width: 842, height: 595, rotate: 0, items, rules }
}
