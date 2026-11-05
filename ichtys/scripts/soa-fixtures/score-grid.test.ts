import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  scoreGrid,
  toPrivateGrid,
  type BBox,
  type RawSchedule,
  type ScheduleDoc,
} from './score'

const here = path.dirname(fileURLToPath(import.meta.url))
const ichtys = path.resolve(here, '../..')

function box(x0: number, y0: number, x1: number, y1: number): BBox {
  return [x0, y0, x1, y1]
}

function synthetic(): { gold: ScheduleDoc; raw: RawSchedule } {
  const gold: ScheduleDoc = {
    document: { pages: 8, sopPages: [6, 7], falseHitPages: [2] },
    tables: [{ key: 'T1', title: 'Cronograma breve', pages: [6, 7], outcome: 'complete', reasons: [] }],
    visits: [
      {
        key: 'Q1', tableKey: 'T1', printedId: 'V1', label: 'Selección',
        timing: { kind: 'scheduled', value: 1, unit: 'day', anchor: null, recurrence: null },
        window: null, type: 'standard', page: 6, bbox: box(100, 700, 160, 720),
      },
    ],
    cells: [
      { visitKey: 'Q1', procedureKey: 'P1', mark: 'x', noteRefs: ['1'], page: 6, bbox: box(100, 680, 160, 700) },
      { visitKey: 'Q1', procedureKey: 'P2', mark: 'prn_range', noteRefs: [], page: 6, bbox: box(160, 660, 220, 680) },
      { visitKey: 'Q1', procedureKey: 'P3', mark: 'prn_range', noteRefs: [], page: 6, bbox: box(220, 660, 280, 680) },
    ],
  }
  const raw: RawSchedule = {
    tables: [
      {
        key: 'T1',
        pages: [6, 7],
        columns: [
          { index: 0, page: 6, xCenter: 130, headerText: 'V1', headerBBox: box(100, 700, 160, 720) },
          { index: 1, page: 7, xCenter: 130, headerText: 'V1', headerBBox: box(100, 700, 160, 720) },
        ],
        cells: [
          { page: 6, bbox: box(100, 680, 160, 700), kind: 'mark', text: 'X', noteRefs: ['1'], spanCols: [] },
          { page: 6, bbox: box(160, 660, 280, 680), kind: 'merged', text: 'según necesidad', noteRefs: [], spanCols: [1, 2] },
        ],
      },
    ],
    location: { rejected: [{ page: 2, reason: 'toc' }] },
  }
  return { gold, raw }
}

function walkNumbers(value: unknown, allowed: Set<string>): void {
  if (value === null || typeof value === 'number') return
  expect(typeof value).not.toBe('string')
  expect(Array.isArray(value)).toBe(false)
  expect(typeof value).toBe('object')
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    expect(allowed.has(key)).toBe(true)
    walkNumbers(inner, allowed)
  }
}

describe('calificador de geometría', () => {
  it('acepta una grilla que cae en las cajas, incluida la cabecera repetida', () => {
    const { gold, raw } = synthetic()
    const report = scoreGrid(gold, raw)
    expect(report.pages).toEqual({ tp: 2, fp: 0, fn: 0 })
    expect(report.tables).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(report.columns).toEqual({ tp: 2, fp: 0, fn: 0 })
    expect(report.markedCells).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(report.mergedCells).toEqual({ tp: 2, fp: 0, fn: 0 })
    expect(report.noteCalls).toEqual({ tp: 1, fp: 0, fn: 0 })
  })

  it('cuenta un falso acierto localizado y una página de grilla que falta', () => {
    const { gold } = synthetic()
    const hit = scoreGrid(gold, { tables: [{ key: 'T1', pages: [2, 6] }] })
    expect(hit.pages).toEqual({ tp: 1, fp: 1, fn: 1 })
    const missing = scoreGrid(gold, { tables: [{ key: 'T1', pages: [2] }] })
    expect(missing.pages).toEqual({ tp: 0, fp: 1, fn: 2 })
  })

  it('no cuenta como falso positivo una página rechazada que no fue localizada', () => {
    const { gold, raw } = synthetic()
    raw.tables![0]!.pages = [6, 7]
    const report = scoreGrid(gold, raw)
    expect(report.pages).toEqual({ tp: 2, fp: 0, fn: 0 })
  })

  it('una marca corrida no cae dentro de la celda', () => {
    const { gold, raw } = synthetic()
    raw.tables![0]!.cells![0]!.bbox = box(0, 0, 4, 4)
    const report = scoreGrid(gold, raw)
    expect(report.markedCells).toEqual({ tp: 0, fp: 1, fn: 1 })
  })

  it('un rango sin celda combinada queda sin cubrir', () => {
    const { gold, raw } = synthetic()
    raw.tables![0]!.cells = raw.tables![0]!.cells!.filter((cell) => cell.kind !== 'merged')
    const report = scoreGrid(gold, raw)
    expect(report.mergedCells).toEqual({ tp: 0, fp: 0, fn: 2 })
  })

  it('una llamada a nota en otra fila no vincula', () => {
    const { gold, raw } = synthetic()
    raw.tables![0]!.cells![0]!.noteRefs = []
    raw.tables![0]!.cells!.push({ page: 6, bbox: box(100, 10, 160, 30), kind: 'text', noteRefs: ['1'], spanCols: [] })
    const report = scoreGrid(gold, raw)
    expect(report.noteCalls).toEqual({ tp: 0, fp: 1, fn: 1 })
  })

  it('alinea una tabla con otro nombre antes de medir las columnas', () => {
    const { gold, raw } = synthetic()
    raw.tables![0]!.key = 'A'
    const report = scoreGrid(gold, raw)
    expect(report.tables).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(report.columns).toEqual({ tp: 2, fp: 0, fn: 0 })
  })

  it('reconstruye F4 desde el gold y una geometría inventada no pasa', () => {
    const gold = JSON.parse(readFileSync(path.join(ichtys, 'fixtures/soa/F4.gold.json'), 'utf8')) as ScheduleDoc
    const raw = gridFromGold(gold)
    const report = scoreGrid(gold, raw)
    const marks = (gold.cells ?? []).filter((cell) => cell.mark === 'x' || cell.mark === 'conditional')
    const refs = (gold.cells ?? []).reduce((sum, cell) => sum + (cell.noteRefs?.length ?? 0), 0)
    expect(marks).toHaveLength(45)
    expect(report.pages).toEqual({ tp: 2, fp: 0, fn: 0 })
    expect(report.tables).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(report.columns).toEqual({ tp: 12, fp: 0, fn: 0 })
    expect(report.markedCells).toEqual({ tp: 45, fp: 0, fn: 0 })
    expect(report.mergedCells).toEqual({ tp: 0, fp: 0, fn: 0 })
    expect(report.noteCalls).toEqual({ tp: refs, fp: 0, fn: 0 })
    expect(refs).toBeGreaterThan(0)

    const broken = gridFromGold(gold)
    const column = broken.tables![0]!.columns!.find((item) => item.page === 6)
    column!.xCenter = 0
    const shifted = scoreGrid(gold, broken)
    expect(shifted.columns.fp).toBe(1)
    expect(shifted.columns.fn).toBe(1)
  })

  it('en modo private la grilla no tiene texto ni claves de tabla', () => {
    const { gold, raw } = synthetic()
    const report = toPrivateGrid(scoreGrid(gold, raw))
    const dumped = JSON.stringify(report)
    expect(dumped).not.toContain('Cronograma')
    expect(dumped).not.toContain('Selección')
    expect(dumped).not.toContain('V1')
    expect(dumped).not.toContain('T1')
    expect(dumped).not.toContain('según')
    const allowed = new Set(['pages', 'tables', 'columns', 'markedCells', 'mergedCells', 'noteCalls', 'tp', 'fp', 'fn'])
    walkNumbers(report, allowed)
    expect(report.pages.tp).toBe(2)
    expect(report.markedCells.tp).toBe(1)
  })

  it('el CLI --grid --private imprime solo contadores', () => {
    const { gold, raw } = synthetic()
    const dir = mkdtempSync(path.join(tmpdir(), 'soa-grid-'))
    const goldPath = path.join(dir, 'gold.json')
    const rawPath = path.join(dir, 'raw.json')
    writeFileSync(goldPath, JSON.stringify(gold))
    writeFileSync(rawPath, JSON.stringify(raw))
    const run = spawnSync(process.execPath, [
      '--experimental-strip-types',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      'scripts/soa-fixtures/score.ts',
      '--grid', '--private',
      '--gold', goldPath,
      '--candidate', rawPath,
    ], { cwd: ichtys, encoding: 'utf8' })
    expect(run.status).toBe(0)
    const report = JSON.parse(run.stdout) as ReturnType<typeof toPrivateGrid>
    expect(report.pages).toEqual({ tp: 2, fp: 0, fn: 0 })
    expect(report.columns).toEqual({ tp: 2, fp: 0, fn: 0 })
    expect(run.stdout).not.toContain('Selección')
    expect(run.stdout).not.toContain('V1')
  })
})

function gridFromGold(doc: ScheduleDoc): RawSchedule {
  const tables: NonNullable<RawSchedule['tables']> = []
  for (const table of doc.tables ?? []) {
    const pages = table.pages ?? []
    const columns: NonNullable<RawSchedule['tables']>[number]['columns'] = []
    let index = 0
    for (const visit of doc.visits ?? []) {
      if (visit.tableKey !== table.key || visit.page == null || !visit.bbox) continue
      const xCenter = (visit.bbox[0] + visit.bbox[2]) / 2
      for (const page of pages) {
        columns.push({
          index,
          page,
          xCenter,
          x0: visit.bbox[0],
          x1: visit.bbox[2],
          headerText: visit.printedId ?? visit.label ?? '',
          headerBBox: visit.bbox,
        })
        index += 1
      }
    }
    const cells: NonNullable<NonNullable<RawSchedule['tables']>[number]['cells']> = []
    for (const cell of doc.cells ?? []) {
      const visit = (doc.visits ?? []).find((item) => item.key === cell.visitKey)
      if (!visit || visit.tableKey !== table.key || cell.page == null || !cell.bbox) continue
      if (cell.mark !== 'x' && cell.mark !== 'conditional') continue
      cells.push({
        page: cell.page,
        bbox: cell.bbox,
        kind: 'mark',
        text: 'X',
        noteRefs: [...(cell.noteRefs ?? [])],
        spanCols: [],
        distanceToCenter: 0,
      })
    }
    tables.push({ key: table.key, pages: [...pages], columns, cells, outcome: 'complete', reasons: [] })
  }
  return {
    tables,
    location: {
      rejected: (doc.document?.falseHitPages ?? []).map((page) => ({ page, reason: 'toc' })),
    },
  }
}
