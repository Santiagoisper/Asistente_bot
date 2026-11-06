import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { scoreSchedule, type Counts, type ScheduleDoc, type ScoreReport } from './score'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/soa')
const IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F6b', 'F7', 'F8'] as const

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function expectZeroErrors(counts: Counts, label: string): void {
  expect(counts.fp, label).toBe(0)
  expect(counts.fn, label).toBe(0)
}

function expectPerfect(report: ScoreReport, id: string): void {
  const fields = [
    'visits',
    'windows',
    'types',
    'attributes',
    'cells',
    'prnCells',
    'notes',
    'inconsistencies',
    'failedTables',
  ] as const
  for (const field of fields) expectZeroErrors(report[field], `${id} ${field}`)
  for (const [key, counts] of Object.entries(report.cellsByTable)) {
    expectZeroErrors(counts, `${id} cellsByTable ${key}`)
  }
  for (const [key, counts] of Object.entries(report.cellsByVisitType)) {
    expectZeroErrors(counts, `${id} cellsByVisitType ${key}`)
  }
  for (const [key, counts] of Object.entries(report.conditions)) {
    expectZeroErrors(counts, `${id} conditions ${key}`)
  }
  expect(report.printedIds.inexact, id).toBe(0)
  expect(report.printedIds.invented, id).toBe(0)
  expect(report.printedIds.exact, id).toBeGreaterThan(0)
  expect(report.visits.tp, id).toBeGreaterThan(0)
}

describe('gold contra sí mismo', () => {
  for (const id of IDS) {
    it(`${id} no tiene falsos positivos ni falsos negativos`, () => {
      const gold = JSON.parse(readFileSync(resolve(FIXTURES, `${id}.gold.json`), 'utf8')) as ScheduleDoc
      expectPerfect(scoreSchedule(clone(gold), clone(gold)), id)
    })
  }

  it('F3 no cuenta como acierto la ventana plantada en la celda que no cita la nota', () => {
    const gold = JSON.parse(readFileSync(resolve(FIXTURES, 'F3.gold.json'), 'utf8')) as ScheduleDoc
    expect(scoreSchedule(clone(gold), clone(gold)).procedureWindows).toEqual({ tp: 0, fp: 1, fn: 1 })
  })

  it('F8 con las claves del candidato invertidas da el mismo puntaje', () => {
    const gold = JSON.parse(readFileSync(resolve(FIXTURES, 'F8.gold.json'), 'utf8')) as ScheduleDoc
    const straight = scoreSchedule(clone(gold), clone(gold))
    const swapped = clone(gold)
    const flip = (key: string | null | undefined) => (key === 'T1' ? 'T2' : key === 'T2' ? 'T1' : key)
    for (const table of swapped.tables ?? []) table.key = flip(table.key) ?? table.key
    for (const visit of swapped.visits ?? []) visit.tableKey = flip(visit.tableKey) ?? null
    for (const note of swapped.notes ?? []) note.tableKey = flip(note.tableKey) ?? note.tableKey
    expect(scoreSchedule(clone(gold), swapped)).toEqual(straight)
  })
})
