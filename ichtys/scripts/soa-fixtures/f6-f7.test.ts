/**
 * Contrato del generador 1.3.0. F6 y F7 son la verdad sintética para el
 * lector: el test mira el gold, no una medición del extractor.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/soa')

interface Box {
  bbox: number[]
}

interface F6Column {
  index: number
  text: string
  dash: boolean
  glyph: string
  fontSize: number
  baseline: number
}

interface F6Page {
  page: number
  rows: number
  label: { text: string } | null
  labelColumn: { countsAsVisit: boolean }
  commentsStrip: { countsAsVisit: boolean }
  columns: F6Column[]
  periods: Array<{ label: string; start: number; end: number }>
  timeRow: { label: string; baseline: number }
}

interface F6Gold {
  fixture: string
  seed: number
  generatorVersion: string
  document: { pages: number; sopPages: number[]; falseHitPages: number[]; gridOrientation: string; gridPageSize: number[] }
  header: {
    kind: string
    label: string | null
    integerRowLabeled: boolean
    repeatedOnEveryGridPage: boolean
    rowsPerPage: number[]
    tokens: Array<{ text: string; dash: boolean }>
    periods: Array<{ label: string; start: number; end: number }>
    timeRowLabel: string
    pages: F6Page[]
  }
  visits: Array<{ printedId: string | null }>
  cells: unknown[]
}

interface F7Column {
  prefix: string
  number: string
  printedId: string
  numberFontSize: number
}

interface F7Page {
  page: number
  visitColumns: number
  dataLabelX: number
  cardX: number
  prefixBaseline: number
  numberBaseline: number
  firstDataBaseline: number
  labelColumn: { countsAsVisit: boolean }
  headerRows: Array<{ role: string; fontSize: number; baseline: number }>
  prefixRow: Box
  numberRow: Box
  columns: F7Column[]
  dataRows: Box[]
}

interface F7Strip {
  key: string
  prefix: string
  visitColumns: number
  labelColumnCountsAsVisit: boolean
  repeatedOnEveryGridPage: boolean
  pages: F7Page[]
}

interface F7Gold {
  fixture: string
  seed: number
  generatorVersion: string
  document: { sopPages: number[]; falseHitPages: number[]; gridOrientation: string; gridPageSize: number[] }
  strips: F7Strip[]
  cells: Array<{ visitKey: string; mark: string }>
  visits: Array<{ key: string; printedId: string }>
}

function load<T>(id: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES, `${id}.gold.json`), 'utf8')) as T
}

describe('F6 — encabezado numérico sin prefijo', () => {
  const gold = load<F6Gold>('F6')

  it('es del generador 1.3.0 y tiene 22 páginas apaisadas de cronograma', () => {
    expect(gold.fixture).toBe('F6')
    expect(gold.seed).toBe(1006)
    expect(gold.generatorVersion).toBe('1.3.0')
    expect(gold.document.gridOrientation).toBe('landscape')
    expect(gold.document.gridPageSize).toEqual([792, 612])
    expect(gold.document.sopPages.length).toBeGreaterThanOrEqual(20)
    expect(gold.document.sopPages).toHaveLength(22)
    expect(gold.document.falseHitPages).toEqual([2])
    expect(load<{ generatorVersion: string }>('F1').generatorVersion).toBe('1.1.0')
  })

  it('repite la fila de enteros sin etiqueta, con tres guiones y entre 2 y 6 filas', () => {
    expect(gold.header.kind).toBe('numeric_visit')
    expect(gold.header.label).toBeNull()
    expect(gold.header.integerRowLabeled).toBe(false)
    expect(gold.header.timeRowLabel).toBe('Día')
    expect(gold.header.repeatedOnEveryGridPage).toBe(true)
    expect(gold.header.periods.map((period) => period.label)).toEqual(['Selección', 'Tratamiento', 'Seguimiento'])
    for (const period of gold.header.periods) expect(period.end - period.start).toBeGreaterThanOrEqual(2)
    const dashes = gold.header.tokens.filter((token) => token.dash)
    expect(dashes.length).toBeGreaterThanOrEqual(3)
    const dashAt = gold.header.tokens.flatMap((token, index) => (token.dash ? [index] : []))
    expect(dashAt.some((index, position) => dashAt[position + 1] === index + 2)).toBe(true)
    const printed = gold.header.tokens.map((token) => (token.dash ? '-' : token.text)).join(' ')
    expect(printed).toContain('4 - 5 6 - 7 - 8')
    const integers = gold.header.tokens.filter((token) => !token.dash).map((token) => Number(token.text))
    expect(integers).toEqual([...integers].sort((a, b) => a - b))
    expect(new Set(integers).size).toBe(integers.length)
    expect(gold.header.pages.map((page) => page.page)).toEqual(gold.document.sopPages)
    for (const page of gold.header.pages) {
      expect(page.label).toBeNull()
      expect(page.timeRow.label).toBe('Día')
      expect(page.columns[0]!.baseline - page.timeRow.baseline).toBeGreaterThanOrEqual(14)
      expect(page.labelColumn.countsAsVisit).toBe(false)
      expect(page.commentsStrip.countsAsVisit).toBe(false)
      expect(page.rows).toBeGreaterThanOrEqual(2)
      expect(page.rows).toBeLessThanOrEqual(6)
      expect(page.columns.map((column) => column.glyph)).toEqual(gold.header.tokens.map((token) => (token.dash ? '-' : token.text)))
    }
    expect(gold.header.rowsPerPage).toContain(6)
    expect(gold.visits.filter((visit) => visit.printedId != null).every((visit) => /^\d+$/.test(visit.printedId!))).toBe(true)
    expect(gold.visits.filter((visit) => visit.printedId == null).length).toBe(dashes.length)
    expect(gold.cells.length).toBeGreaterThan(0)
  })
})

describe('F7 — dos tiras con la ficha partida', () => {
  const gold = load<F7Gold>('F7')

  it('pone 20 y 24 columnas en cada página apaisada, con el número a 9 pt', () => {
    expect(gold.fixture).toBe('F7')
    expect(gold.seed).toBe(1007)
    expect(gold.generatorVersion).toBe('1.3.0')
    expect(gold.document.gridOrientation).toBe('landscape')
    expect(gold.document.gridPageSize).toEqual([792, 612])
    expect(gold.document.sopPages.length).toBeGreaterThanOrEqual(4)
    expect(gold.document.falseHitPages).toEqual([2])
    expect(gold.strips.map((strip) => [strip.key, strip.prefix, strip.visitColumns])).toEqual([
      ['A', 'V', 20],
      ['B', 'W', 24],
    ])
    const shared = gold.strips[0]!.pages.map((page) => page.page)
    expect(shared).toEqual(gold.document.sopPages)
    expect(gold.strips[1]!.pages.map((page) => page.page)).toEqual(shared)
    expect(JSON.stringify(gold.strips)).not.toContain('Serie')
    expect(JSON.stringify(gold.strips)).not.toContain('Ficha')
    const gaps = [6, 18]
    const cardX = [237, 213]
    expect(gold.strips[0]!.pages[0]!.prefixBaseline - gold.strips[1]!.pages[0]!.prefixBaseline).toBe(45)
    for (const [index, strip] of gold.strips.entries()) {
      expect(strip.repeatedOnEveryGridPage).toBe(true)
      expect(strip.labelColumnCountsAsVisit).toBe(false)
      for (const page of strip.pages) {
        expect(page.headerRows).toEqual([
          { role: 'prefix', fontSize: 7, baseline: page.prefixBaseline },
          { role: 'number', fontSize: 9, baseline: page.numberBaseline },
        ])
        expect(page.prefixBaseline - page.numberBaseline).toBe(9)
        expect(page.numberBaseline - page.firstDataBaseline).toBe(gaps[index])
        expect(page.dataLabelX).toBe(82)
        expect(page.cardX).toBe(cardX[index])
        expect(page.labelColumn.countsAsVisit).toBe(false)
        expect(page.columns).toHaveLength(strip.visitColumns)
        for (const column of page.columns) {
          expect(column.prefix).toBe(strip.prefix)
          expect(column.numberFontSize).toBe(9)
          expect(column.printedId).toBe(`${strip.prefix}${column.number}`)
        }
      }
    }
    expect(gold.strips[1]!.pages.every((page) => page.columns[0]!.number === '1/')).toBe(true)
    const marked = new Set(gold.cells.filter((cell) => cell.mark === 'x').map((cell) => cell.visitKey))
    expect(gold.visits.every((visit) => marked.has(visit.key))).toBe(true)
  })
})
