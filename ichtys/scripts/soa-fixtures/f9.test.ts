/**
 * F9 — encabezado mixto (G22 §3, D9 commit 2). El test mira el gold que
 * escribe el generador 1.3.0, no una medición del lector.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const GOLD = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/soa/F9.gold.json')

const PRINTED = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  'ET', 'FA', 'EOS', 'Fin etapa', 'Anotacion larga de las fichas',
] as const

interface Column {
  index: number
  printedId: string
  kind: string
  parts: string[]
  baseline: number
}

interface Gold {
  fixture: string
  seed: number
  generatorVersion: string
  document: { pages: number; sopPages: number[]; falseHitPages: number[] }
  header: {
    kind: string
    visitColumns: number
    label: { text: string; baseline: number }
    labelColumnCountsAsVisit: boolean
    windowCoversLabel: boolean
    cardBaseline: number
    columns: Column[]
    pages: Array<{ page: number; columns: Column[]; window: { coversLabel: boolean } }>
  }
  visits: Array<{ key: string; printedId: string }>
  cells: Array<{ visitKey: string }>
}

describe('F9 encabezado mixto', () => {
  const gold = JSON.parse(readFileSync(GOLD, 'utf8')) as Gold

  it('sale del generador 1.3.0 con 15 columnas y la etiqueta fuera', () => {
    expect(gold.fixture).toBe('F9')
    expect(gold.seed).toBe(1010)
    expect(gold.generatorVersion).toBe('1.3.0')
    expect(gold.document.pages).toBe(3)
    expect(gold.document.sopPages).toEqual([2, 3])
    expect(gold.document.falseHitPages).toEqual([])
    expect(gold.header.kind).toBe('mixed')
    expect(gold.header.visitColumns).toBe(15)
    expect(gold.header.label.text).toBe('Visita')
    expect(gold.header.label.text).toHaveLength(6)
    expect(gold.header.label.baseline).toBe(gold.header.cardBaseline)
    expect(gold.header.labelColumnCountsAsVisit).toBe(false)
    expect(gold.header.windowCoversLabel).toBe(false)
    expect(gold.header.columns.map((column) => column.printedId)).toEqual([...PRINTED])
    expect(gold.header.columns[13]).toMatchObject({ kind: 'split', parts: ['Fin', 'etapa'] })
    expect(gold.header.columns[14]?.kind).toBe('legend')
  })

  it('repite el encabezado y cada columna tiene al menos una marca', () => {
    expect(gold.header.pages.map((page) => page.page)).toEqual([2, 3])
    for (const page of gold.header.pages) {
      expect(page.columns.map((column) => column.printedId)).toEqual([...PRINTED])
      expect(page.window.coversLabel).toBe(false)
    }
    expect(gold.visits.map((visit) => visit.printedId)).toEqual([...PRINTED])
    const marks = new Map<string, number>()
    for (const cell of gold.cells) marks.set(cell.visitKey, (marks.get(cell.visitKey) ?? 0) + 1)
    expect(marks.size).toBe(15)
    for (const count of marks.values()) expect(count).toBeGreaterThan(0)
    expect(gold.cells).toHaveLength(45)
  })
})
