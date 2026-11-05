import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { scoreSchedule, type Counts, type ScheduleDoc, type ScoreReport } from './score'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/soa')
const IDS = ['F1', 'F2', 'F3', 'F4', 'F5'] as const

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
})
