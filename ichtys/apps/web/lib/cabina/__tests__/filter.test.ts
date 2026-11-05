import { describe, expect, it } from 'vitest'
import { demoStudy } from '../demo-data'
import { buildSheet, conditionMatches } from '../filter'
import type { CellDef, Condition, PatientState, ProcedureDef, VisitDef } from '../types'

const state: PatientState = { dt2: true, erc: true, ic: false, wocbp: false, arm: 'B' }

const visit: VisitDef = {
  key: 'V11',
  tableKey: 'T1',
  tableTitle: 'Rama principal',
  printedId: 'V11',
  label: 'Semana 56',
  timing: { kind: 'annual', value: 56, unit: 'week', anchor: 'v2', recurrence: null },
  window: { before: 5, after: 5, unit: 'day' },
  type: 'standard',
  attributes: { fasting: true, onSite: true, armOnly: null },
  annual: true,
}

function condition(key: string, kind: Condition['kind'] = 'population'): Condition {
  return { kind, key, expr: key }
}

function procedure(partial: Partial<ProcedureDef> & Pick<ProcedureDef, 'key' | 'section' | 'order'>): ProcedureDef {
  return {
    label: partial.key,
    detail: '',
    visitKeys: ['V11'],
    orderFixed: false,
    conditions: [],
    ...partial,
  }
}

function cell(procedureKey: string): CellDef {
  return {
    visitKey: 'V11',
    procedureKey,
    mark: 'x',
    page: 19,
    certainty: 'high',
    noteRefs: [],
    quote: 'Cita',
    highlights: [],
    howRead: 'Dos fuentes coinciden',
    sourceLabel: 'Tabla y texto',
  }
}

describe('condiciones', () => {
  it('exige que cada condición del paciente coincida y cierra si la clave es desconocida', () => {
    expect(conditionMatches(condition('dt2'), state, visit)).toBe(true)
    expect(conditionMatches(condition('wocbp'), state, visit)).toBe(false)
    expect(conditionMatches(condition('arm:B', 'arm'), state, visit)).toBe(true)
    expect(conditionMatches(condition('arm:A', 'arm'), state, visit)).toBe(false)
    expect(conditionMatches(condition('fasting', 'fasting'), state, visit)).toBe(true)
    expect(conditionMatches(condition('desconocida'), state, visit)).toBe(false)
  })

  it('oculta lo que no aplica, conserva la celda y ordena la hoja', () => {
    const procedures = [
      procedure({ key: 'consent', section: 'day', order: 1 }),
      procedure({ key: 'arm-a', section: 'day', order: 2, conditions: [condition('arm:A', 'arm')] }),
      procedure({ key: 'pregnancy', section: 'day', order: 3, conditions: [condition('wocbp')] }),
      procedure({ key: 'heart', section: 'before', order: 1, conditions: [condition('ic')] }),
      procedure({ key: 'fundus', section: 'day', order: 4, conditions: [condition('dt2')] }),
      procedure({ key: 'other-visit', section: 'day', order: 1, visitKeys: ['V4'] }),
    ]
    const sheet = buildSheet(visit, procedures, [cell('fundus')], state)
    expect(sheet.shown.map((item) => item.procedure.key)).toEqual(['consent', 'fundus'])
    expect(sheet.shown.find((item) => item.procedure.key === 'fundus')?.cell?.page).toBe(19)
    expect(sheet.hidden.map((item) => item.procedure.key).sort()).toEqual(['arm-a', 'heart', 'pregnancy'])
  })

  it('en la demo, 0042 en V11 esconde siete procedimientos y mostrar edad fértil los reduce', () => {
    const visitV11 = demoStudy.visits.find((item) => item.key === 'V11')
    const patient = demoStudy.patients.find((item) => item.code === '0042')
    expect(visitV11).toBeTruthy()
    expect(patient).toBeTruthy()
    const base = { ...patient!.conditions, arm: patient!.arm }
    const sheet = buildSheet(visitV11!, demoStudy.procedures, demoStudy.cells, base)
    expect(sheet.hidden.map((item) => item.procedure.key).sort()).toEqual([
      'contraception-counsel',
      'diary-a',
      'dispense-a',
      'heart-failure',
      'nt-probnp',
      'pregnancy-serum',
      'pregnancy-urine',
    ])
    const opened = buildSheet(visitV11!, demoStudy.procedures, demoStudy.cells, { ...base, wocbp: true })
    expect(opened.hidden.length).toBeLessThan(sheet.hidden.length)
    expect(opened.shown.some((item) => item.procedure.key === 'pregnancy-serum')).toBe(true)
  })
})
