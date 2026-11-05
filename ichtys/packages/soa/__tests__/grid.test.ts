/**
 * T3 + T4 + T8 + T11 — grid (etapa b, orden B-P2 §5).
 *
 * El "rojo" es la pérdida de posición del parser actual (D1): sin cajas no
 * hay grilla, así que ninguna de estas aserciones era posible. El matching
 * contra el gold es geométrico (ayudante local de test, hasta que exista
 * `scoreGrid` de C5): columnas por centro-x dentro de la caja de la visita
 * gold; celdas por centro dentro de la caja de la celda gold, ambas en la
 * página del gold — el gold guarda cada celda con la banda local de SU
 * página, igual que la grilla cruda (las tiras de F3 re-escalan columnas).
 *
 * T8 usa las columnas sombreadas que el generador fija por tabla (scripts/
 * soa-fixtures/generate.py, `new_table(..., shaded, ...)`): F1 T1 {24} y
 * T2 {2..5}; F2 T2 {12,13} y T3 {10..13}. En esas columnas la marca se
 * escribe en OTRA operación de texto pegada al techo de la fila.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadPageGeometry, locateSchedule, readGrid } from '../index'
import type { BBox, RawSchedule } from '../types'

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa/', import.meta.url))

interface GoldVisit {
  key: string
  tableKey: string
  printedId: string | null
  page: number
  bbox: BBox
}

interface GoldCell {
  visitKey: string
  procedureKey: string
  page: number
  bbox: BBox
  mark: string
}

interface Gold {
  document: { sopPages: number[]; falseHitPages: number[] }
  visits: GoldVisit[]
  cells: GoldCell[]
}

const FIXTURES = ['F1', 'F2', 'F3', 'F4', 'F5'] as const

/** Columnas sombreadas por tabla (del generador), índice absoluto 0-based. */
const SHADED: Record<string, Record<string, number[]>> = {
  F1: { T1: [24], T2: [2, 3, 4, 5] },
  F2: { T2: [12, 13], T3: [10, 11, 12, 13] },
}

function readGold(fixture: string): Gold {
  return JSON.parse(readFileSync(`${FIXTURES_DIR}${fixture}.gold.json`, 'utf8'))
}

function readPdf(fixture: string): Uint8Array {
  return new Uint8Array(readFileSync(`${FIXTURES_DIR}${fixture}.pdf`))
}

/** JSON determinista: claves ordenadas recursivamente. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

interface Loaded {
  gold: Gold
  schedule: RawSchedule
}

const loaded = new Map<string, Loaded>()

async function loadFixture(fixture: string): Promise<Loaded> {
  const cached = loaded.get(fixture)
  if (cached) return cached
  const pages = await loadPageGeometry(readPdf(fixture))
  const schedule = readGrid(pages, locateSchedule(pages))
  const entry = { gold: readGold(fixture), schedule }
  loaded.set(fixture, entry)
  return entry
}

/** Matchea 1-a-1 por geometría: candidatos con centro dentro de la caja, el más cercano gana. */
function matchBoxes<G extends { page: number; bbox: BBox }, M extends { page: number; bbox: BBox }>(
  golds: G[],
  mine: M[],
): { pairs: number; goldUnmatched: number; mineUnmatched: number } {
  const used = new Set<number>()
  let pairs = 0
  for (const gold of golds) {
    const [gx0, gy0, gx1, gy1] = gold.bbox
    let best = -1
    let bestDist = Infinity
    mine.forEach((cell, i) => {
      if (used.has(i) || cell.page !== gold.page) return
      const cx = (cell.bbox[0] + cell.bbox[2]) / 2
      const cy = (cell.bbox[1] + cell.bbox[3]) / 2
      if (cx < gx0 - 1 || cx > gx1 + 1 || cy < gy0 - 1 || cy > gy1 + 1) return
      const dist = Math.abs(cx - (gx0 + gx1) / 2) + Math.abs(cy - (gy0 + gy1) / 2)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    if (best >= 0) {
      used.add(best)
      pairs++
    }
  }
  return { pairs, goldUnmatched: golds.length - pairs, mineUnmatched: mine.length - pairs }
}

describe('T3 — columnas: cantidad y centro dentro de la caja de la visita gold', () => {
  const expected: Record<string, number> = { F1: 46, F2: 35, F3: 31, F4: 6, F5: 20 }

  for (const fixture of FIXTURES) {
    it(`${fixture}: ${expected[fixture]} columnas, P = R = 100 % (≥ 99 %)`, async () => {
      const { gold, schedule } = await loadFixture(fixture)
      const columns = schedule.tables.flatMap((t) =>
        t.columns.map((c) => ({ page: c.page, bbox: c.headerBBox, tableKey: t.key })),
      )
      expect(columns.length).toBe(expected[fixture])
      let pairs = 0
      for (const table of schedule.tables) {
        const goldVisits = gold.visits
          .filter((v) => v.tableKey === table.key)
          .sort((a, b) => a.bbox[0] - b.bbox[0])
        const mine = table.columns.map((c) => ({ page: c.page, bbox: c.headerBBox as BBox }))
        const match = matchBoxes(goldVisits, mine)
        pairs += match.pairs
        expect(match.mineUnmatched).toBe(0)
      }
      expect(pairs).toBe(expected[fixture])
    })
  }

  it('F3: las 3 columnas sin número (—) quedan como columnas propias', async () => {
    const { schedule } = await loadFixture('F3')
    const t1 = schedule.tables[0]!
    expect(t1.columns.length).toBe(19)
    expect(t1.columns.filter((c) => c.headerText.trim() === '—').length).toBe(3)
  })
})

describe('T4 — celdas marcadas por centro dentro de la caja gold', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture}: P ≥ 98 %, R ≥ 97 % por fixture`, async () => {
      const { gold, schedule } = await loadFixture(fixture)
      // F2: los rangos "según necesidad" (prn_range) son celdas combinadas
      // del commit 4; el umbral de T4 no los cuenta.
      const goldCells = gold.cells.filter((c) => c.mark !== 'prn_range')
      const mine = schedule.tables.flatMap((t) => t.cells)
      const { pairs, goldUnmatched, mineUnmatched } = matchBoxes(goldCells, mine)
      const precision = pairs / (pairs + mineUnmatched)
      const recall = pairs / (pairs + goldUnmatched)
      expect(precision).toBeGreaterThanOrEqual(0.98)
      expect(recall).toBeGreaterThanOrEqual(0.97)
      // El gold no está vacío (F4 es el fixture chico: 45 celdas sin prn_range).
      expect(goldCells.length).toBeGreaterThan(fixture === 'F4' ? 40 : 100)
    })
  }
})

describe('T8 — columnas sombreadas con la marca en otra operación de texto', () => {
  for (const fixture of ['F1', 'F2'] as const) {
    it(`${fixture}: celdas de las columnas sombreadas R = 100 %`, async () => {
      const { gold, schedule } = await loadFixture(fixture)
      const shaded = SHADED[fixture]!
      let total = 0
      let matched = 0
      for (const [tableKey, absoluteIndexes] of Object.entries(shaded)) {
        const tableVisits = gold.visits
          .filter((v) => v.tableKey === tableKey)
          .sort((a, b) => a.bbox[0] - b.bbox[0])
        const shadedKeys = new Set(
          absoluteIndexes.map((i) => tableVisits[i]?.key).filter(Boolean) as string[],
        )
        const goldCells = gold.cells.filter(
          (c) => shadedKeys.has(c.visitKey) && c.mark !== 'prn_range',
        )
        const mine = (schedule.tables.find((t) => t.key === tableKey)?.cells ?? []).map((c) => ({
          page: c.page,
          bbox: c.bbox as BBox,
        }))
        const { pairs, goldUnmatched } = matchBoxes(goldCells, mine)
        total += goldCells.length
        matched += pairs
        expect(goldUnmatched).toBe(0)
      }
      expect(total).toBeGreaterThan(50)
      expect(matched).toBe(total)
    })
  }
})

describe('T11 — determinismo', () => {
  it('F1: dos corridas dan la misma salida (JSON ordenado, byte a byte)', async () => {
    const pages = await loadPageGeometry(readPdf('F1'))
    const first = readGrid(pages, locateSchedule(pages))
    const second = readGrid(pages, locateSchedule(pages))
    expect(stableStringify(second)).toBe(stableStringify(first))
  })
})
