/**
 * Contrato del generador 1.3.0. F6, F7 y F8 son la verdad sintética para el
 * lector: el test mira el gold, no una medición del extractor.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/soa')

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
  index: number
  printedId: string
  split: boolean
  prefix: string | null
  number: string | null
  glyphX: number
  prefixBaseline: number | null
  numberBaseline: number | null
  baseline: number
}

interface F7Week {
  text: string
  split: boolean
  glyphX: number
  prefixBaseline: number | null
  numberBaseline: number | null
  baseline: number
}

interface F7Page {
  page: number
  rows: number
  columns: F7Column[]
  weeks: F7Week[]
  periods: Array<{ label: string; baseline?: number }>
  label: { text: string; x: number; baseline: number }
  periodLabel: { text: string; x: number; baseline: number }
  labelColumn: { countsAsVisit: boolean }
  prefixBaseline: number
  numberBaseline: number
  shortBaseline: number
  weekBaseline: number
  weekNumberBaseline: number
  firstCardX: number
  dataRows: Array<{ baseline: number }>
}

interface F7Gold {
  fixture: string
  seed: number
  generatorVersion: string
  document: {
    pages: number
    sopPages: number[]
    falseHitPages: number[]
    figurePages: number[]
    gridOrientation: string
    gridPageSize: number[]
  }
  tables: Array<{ key: string }>
  header: {
    kind: string
    visitColumns: number
    columnWidth: number
    repeatedOnEveryGridPage: boolean
    label: { text: string; x: number; baseline: number }
    labelColumnCountsAsVisit: boolean
    periods: Array<{ label: string; start: number; end: number }>
    columns: F7Column[]
    weeks: F7Week[]
    prefixBaseline: number
    numberBaseline: number
    shortBaseline: number
    weekBaseline: number
    weekNumberBaseline: number
    firstCardX: number
    pages: F7Page[]
  }
  figure: { page: number; cards: number; gap: number; marks: number; timeline: Array<{ text: string }> }
  cells: Array<{ visitKey: string; mark: string }>
  visits: Array<{ key: string; printedId: string }>
}

interface F8Column {
  prefix: string
  number: string
  printedId: string
  numberFontSize: number
}

interface F8Page {
  page: number
  visitColumns: number
  dataLabelX: number
  cardX: number
  prefixBaseline: number
  numberBaseline: number
  firstDataBaseline: number
  labelColumn: { countsAsVisit: boolean }
  headerRows: Array<{ role: string; fontSize: number; baseline: number }>
  columns: F8Column[]
  dataRows: Array<{ baseline: number }>
}

interface F8Strip {
  key: string
  prefix: string
  visitColumns: number
  labelColumnCountsAsVisit: boolean
  repeatedOnEveryGridPage: boolean
  pages: F8Page[]
}

interface F8Gold {
  fixture: string
  seed: number
  generatorVersion: string
  document: { sopPages: number[]; falseHitPages: number[]; gridOrientation: string; gridPageSize: number[] }
  strips: F8Strip[]
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

describe('F7 — encabezado de varias líneas y página de figura', () => {
  const gold = load<F7Gold>('F7')

  it('repite un solo bloque de 26 columnas en 4 páginas, con la figura delante', () => {
    const header = gold.header
    expect(gold.fixture).toBe('F7')
    expect(gold.seed).toBe(1007)
    expect(gold.generatorVersion).toBe('1.3.0')
    expect(gold.document.pages).toBe(6)
    expect(gold.document.gridOrientation).toBe('landscape')
    expect(gold.document.gridPageSize).toEqual([792, 612])
    expect(gold.document.sopPages).toHaveLength(4)
    expect(gold.document.falseHitPages).toEqual([])
    expect(gold.tables.map((table) => table.key)).toEqual(['T1'])
    expect(header.kind).toBe('multiline_visit')
    expect(header.visitColumns).toBe(26)
    expect(header.repeatedOnEveryGridPage).toBe(true)
    expect(header.labelColumnCountsAsVisit).toBe(false)
    expect(header.pages.map((page) => page.page)).toEqual(gold.document.sopPages)
    expect(gold.figure.page).toBe(gold.document.sopPages[0]! - 1)
    expect(gold.document.figurePages).toEqual([gold.figure.page])
    expect(gold.document.sopPages).not.toContain(gold.figure.page)
    expect(gold.figure.cards).toBe(21)
    expect(gold.figure.gap).toBe(6)
    expect(gold.figure.marks).toBe(0)
    expect(gold.figure.timeline).toHaveLength(21)
    expect(gold.figure.timeline.every((card) => /^S\d+$/.test(card.text))).toBe(true)
    expect(header.periods.map((period) => period.label)).toEqual(['Selección', 'Tratamiento', 'Seguimiento'])
    expect(header.label).toEqual({ text: 'Visita', x: 82, baseline: header.numberBaseline })
    expect(header.firstCardX).toBe(220)
    expect(header.firstCardX).toBeGreaterThanOrEqual(213)
    expect(header.firstCardX).toBeLessThanOrEqual(237)
    expect(header.prefixBaseline - header.numberBaseline).toBe(9)
    expect(header.prefixBaseline - header.weekBaseline).toBe(39)
    expect(header.weekBaseline - header.weekNumberBaseline).toBe(9)
    expect(header.shortBaseline).toBe((header.prefixBaseline + header.numberBaseline) / 2)
    const shorts = header.columns.filter((column) => !column.split)
    const splits = header.columns.filter((column) => column.split)
    expect(shorts.length).toBeGreaterThanOrEqual(4)
    expect(shorts.length).toBeLessThanOrEqual(5)
    expect(shorts[0]!.printedId).toBe('V1')
    expect(shorts[0]!.glyphX).toBeGreaterThanOrEqual(213)
    expect(shorts[0]!.glyphX).toBeLessThanOrEqual(237)
    for (const column of shorts) {
      expect(column.baseline).toBe(header.shortBaseline)
      expect(column.prefix).toBeNull()
    }
    for (const column of splits) {
      expect(column.prefix).toBe('V')
      expect(column.numberBaseline).toBe(header.numberBaseline)
      expect(column.prefixBaseline).toBe(header.prefixBaseline)
      expect(Math.abs(column.glyphX - (header.firstCardX + column.index * header.columnWidth))).toBeLessThanOrEqual(1)
    }
    const wholeWeeks = header.weeks.filter((week) => !week.split)
    const splitWeeks = header.weeks.filter((week) => week.split)
    expect(wholeWeeks.length).toBeGreaterThan(shorts.length)
    expect(splitWeeks.length).toBeGreaterThan(0)
    expect(header.weeks.map((week) => week.text)).toEqual(header.weeks.map((_, index) => `S${index + 1}`))
    for (const week of header.weeks) {
      expect(week.split).toBe(week.text.length > 2)
      if (week.split) {
        expect(week.prefixBaseline! - week.numberBaseline!).toBe(9)
        expect(Math.abs(week.glyphX - (header.firstCardX + header.weeks.indexOf(week) * header.columnWidth))).toBeLessThanOrEqual(1)
      }
    }
    for (const page of header.pages) {
      expect(page.columns.map((column) => column.printedId)).toEqual(header.columns.map((column) => column.printedId))
      expect(page.weeks.map((week) => week.text)).toEqual(header.weeks.map((week) => week.text))
      expect(page.labelColumn.countsAsVisit).toBe(false)
      expect(page.label).toEqual(header.label)
      expect(page.periodLabel.baseline - page.prefixBaseline).toBe(18)
      expect(page.periodLabel.x).toBe(82)
      expect(page.rows).toBe(4)
      expect(page.dataRows.every((row) => row.baseline < page.weekNumberBaseline)).toBe(true)
    }
    expect(JSON.stringify(header)).not.toContain('Serie')
    expect(JSON.stringify(header)).not.toContain('Ficha')
    expect(gold.visits).toHaveLength(26)
    expect(gold.visits.every((visit) => !visit.printedId.startsWith('S'))).toBe(true)
    expect(gold.cells).toHaveLength(208)
    const marked = new Set(gold.cells.filter((cell) => cell.mark === 'x').map((cell) => cell.visitKey))
    expect(gold.visits.every((visit) => marked.has(visit.key))).toBe(true)
  })
})

describe('F8 — dos tablas apiladas con datos entre los encabezados', () => {
  const gold = load<F8Gold>('F8')

  it('pone 20 y 24 columnas en cada página apaisada, con el número a 9 pt', () => {
    expect(gold.fixture).toBe('F8')
    expect(gold.seed).toBe(1008)
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
    const upper = gold.strips[0]!.pages[0]!
    const lower = gold.strips[1]!.pages[0]!
    expect(upper.prefixBaseline - lower.prefixBaseline).toBe(45)
    const between = upper.dataRows.filter((row) => row.baseline < upper.prefixBaseline && row.baseline > lower.prefixBaseline)
    expect(between.length).toBeGreaterThan(0)
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
    expect(gold.cells).toHaveLength(256)
    const marked = new Set(gold.cells.filter((cell) => cell.mark === 'x').map((cell) => cell.visitKey))
    expect(gold.visits.every((visit) => marked.has(visit.key))).toBe(true)
  })
})
