/**
 * F7 corregido (G22 §3 C3) y F8 intacto. La figura de F7 tiene letra de
 * 5 pt, 18,4 pt entre orígenes y ~13,4 pt de hueco. Sale como tabla
 * failed/no_marks. La grilla queda en las páginas 3 a 6.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadPageGeometry, locateSchedule, readGrid } from '../index'
import type { PageGeom } from '../types'

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa/', import.meta.url))

function readPdf(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`${FIXTURES_DIR}${name}.pdf`))
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

describe('F7 — figura aparte y grilla en sus páginas', () => {
  let pages: PageGeom[]

  it('la grilla queda en 3–6 y la figura es failed/no_marks', async () => {
    pages = await loadPageGeometry(readPdf('F7'))
    const location = locateSchedule(pages)
    const schedule = readGrid(pages, location)
    const grid = schedule.tables.find((table) => table.pages.includes(3))!
    const figure = schedule.tables.find((table) => table.pages.includes(2))!
    expect(grid.pages).toEqual([3, 4, 5, 6])
    expect(grid.reasons).not.toContain('no_marks')
    expect(figure.pages).toEqual([2])
    expect(figure.outcome).toBe('failed')
    expect(figure.reasons).toContain('no_marks')
    expect(schedule.tables.some((table) => table.pages.includes(2) && table.pages.includes(3))).toBe(false)
  })

  it('las fichas de la figura miden 5 pt, 18,4 pt entre orígenes y ~13,4 pt de hueco', async () => {
    pages ??= await loadPageGeometry(readPdf('F7'))
    const figure = pages[1]!
    const cards = figure.items
      .filter((item) => /^S\d+$/.test(item.str.trim()))
      .sort((a, b) => a.bbox[0] - b.bbox[0])
    expect(cards).toHaveLength(17)
    for (const card of cards) expect(card.fontSize).toBeCloseTo(5, 1)
    const steps = cards.slice(1).map((card, index) => card.bbox[0] - cards[index]!.bbox[0])
    const gaps = cards.slice(1).map((card, index) => card.bbox[0] - cards[index]!.bbox[2])
    expect(median(steps)).toBeCloseTo(18.4, 1)
    expect(median(gaps)).toBeCloseTo(13.4, 1)
    expect(figure.items.some((item) => item.str.trim() === 'X')).toBe(false)
  })
})

describe('F8 — la regla de la figura no parte sus páginas', () => {
  it('las páginas de grilla siguen juntas y ninguna sale failed/no_marks', async () => {
    const gold = JSON.parse(readFileSync(`${FIXTURES_DIR}F8.gold.json`, 'utf8')) as {
      document: { sopPages: number[] }
    }
    const pages = await loadPageGeometry(readPdf('F8'))
    const location = locateSchedule(pages)
    const schedule = readGrid(pages, location)
    const sop = new Set(gold.document.sopPages)
    const got = new Set(location.tables.flatMap((table) => table.pages))
    for (const page of sop) expect(got.has(page)).toBe(true)
    for (const table of schedule.tables) {
      if (table.pages.some((page) => sop.has(page))) {
        expect(table.reasons).not.toContain('no_marks')
      }
    }
  })
})
