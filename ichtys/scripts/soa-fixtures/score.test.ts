import { describe, expect, it } from 'vitest'
import {
  CONDITION_KINDS,
  VISIT_TYPES,
  adaptLegacyVisits,
  normalizeLabel,
  scoreSchedule,
  similarity,
  toPrivate,
  type ScheduleDoc,
  type VisitRec,
} from './score'

const timing = (value: number | null, unit: 'day' | 'week' | null, kind: VisitRec['timing']['kind'] = 'scheduled'): VisitRec['timing'] => ({
  kind, value, unit, anchor: null, recurrence: null,
})

function gold(): ScheduleDoc {
  return {
    tables: [
      { key: 'T1', title: 'Cronograma principal', pages: [2], outcome: 'complete', reasons: [] },
      { key: 'T2', title: 'Rescate', pages: [3], outcome: 'complete', reasons: [] },
    ],
    visits: [
      { key: 'A', tableKey: 'T1', printedId: 'V1', label: 'Visita 1', timing: timing(1, 'day'), window: { before: 2, after: 2, unit: 'day' }, type: 'standard', attributes: { fasting: true, onSite: true, armOnly: null } },
      { key: 'B', tableKey: 'T1', printedId: 'V2', label: 'Visita 2', timing: timing(1, 'day'), window: { before: 7, after: 0, unit: 'day' }, type: 'standard', attributes: { fasting: false, onSite: true, armOnly: 'A' } },
      { key: 'C', tableKey: 'T2', printedId: 'VR1', label: 'Rescate', timing: timing(12, 'week', 'recurrent'), window: null, type: 'follow_up', attributes: { fasting: null, onSite: true, armOnly: null } },
    ],
    procedures: [
      { key: 'P1', label: 'Signos vitales', kind: 'procedure', aliases: ['vitales'], conditions: [] },
      { key: 'P2', label: 'ECG de 12 derivaciones', kind: 'procedure', aliases: ['electrocardiograma'], conditions: [] },
      { key: 'P3', label: 'Muestra PK', kind: 'procedure', conditions: [] },
      { key: 'P4', label: 'Panel de laboratorio C', kind: 'procedure', conditions: [] },
      { key: 'P5', label: 'Panel de laboratorio C', kind: 'procedure', conditions: [] },
    ],
    cells: [
      { visitKey: 'A', procedureKey: 'P1', mark: 'x', noteRefs: ['1'], conditions: [{ kind: 'arm', expr: 'Solo en participantes del brazo A' }] },
      { visitKey: 'A', procedureKey: 'P2', mark: 'x', noteRefs: [], conditions: [] },
      { visitKey: 'B', procedureKey: 'P1', mark: 'prn_range', noteRefs: [], conditions: [] },
      { visitKey: 'C', procedureKey: 'P3', mark: 'conditional', noteRefs: ['2'], conditions: [{ kind: 'dose_timing', expr: 'Antes de la dosis' }] },
      { visitKey: 'A', procedureKey: 'P4', mark: 'x', noteRefs: [], conditions: [] },
      { visitKey: 'A', procedureKey: 'P5', mark: 'x', noteRefs: [], conditions: [] },
    ],
    notes: [
      { ref: '1', tableKey: 'T1', text: 'Solo en participantes del brazo A', page: 4, conditions: [] },
      { ref: '2', tableKey: 'T2', text: 'Antes de la dosis', page: 5, conditions: [] },
    ],
    outOfTableRules: [
      { text: 'En ayunas de al menos 8 h', page: 1, conditions: [{ kind: 'fasting', expr: '>= 8 h' }] },
    ],
    inconsistencies: [
      { kind: 'duplicated_row' },
      { kind: 'reversed_operator' },
    ],
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('calificador de cronogramas', () => {
  it('normaliza tildes y signos, y corta la similitud en 0,85', () => {
    expect(normalizeLabel('Inclusión/exclusión.')).toBe('inclusion exclusion')
    expect(similarity('ECG de 12 derivaciones', 'ecg de 12 derivaciones')).toBe(1)
    expect(similarity('Panel de laboratorio A', 'Peso')).toBeLessThan(0.85)
  })

  it('pasa con la salida correcta aunque el orden no sea el del gold', () => {
    const source = gold()
    const candidate = clone(source)
    candidate.visits = [...(candidate.visits ?? [])].reverse()
    candidate.procedures = [...(candidate.procedures ?? [])].reverse()
    candidate.cells = [...(candidate.cells ?? [])].reverse()
    const report = scoreSchedule(source, candidate)
    expect(report.visits).toEqual({ tp: 3, fp: 0, fn: 0 })
    expect(report.printedIds).toEqual({ exact: 3, inexact: 0, invented: 0 })
    expect(report.windows).toEqual({ tp: 3, fp: 0, fn: 0 })
    expect(report.types).toEqual({ tp: 3, fp: 0, fn: 0 })
    expect(report.attributes).toEqual({ tp: 9, fp: 0, fn: 0 })
    expect(report.cells).toEqual({ tp: 5, fp: 0, fn: 0 })
    expect(report.prnCells).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(report.notes).toEqual({ tp: 2, fp: 0, fn: 0 })
    expect(report.conditions.arm).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(report.conditions.dose_timing).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(report.conditions.fasting).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(report.inconsistencies).toEqual({ tp: 2, fp: 0, fn: 0 })
    expect(report.failedTables).toEqual({ tp: 0, fp: 0, fn: 0 })
    expect(report.cells.fp + report.cells.fn + report.prnCells.fp + report.prnCells.fn + report.visits.fp + report.visits.fn).toBe(0)
  })

  it('empareja por printedId cuando el tiempo y el tipo coinciden, no por posición', () => {
    const source = gold()
    const candidate = clone(source)
    const visits = candidate.visits ?? []
    const first = visits[0]!
    visits[0] = visits[1]!
    visits[1] = first
    const report = scoreSchedule(source, candidate)
    expect(report.printedIds.exact).toBe(3)
    expect(report.printedIds.inexact).toBe(0)
    expect(report.windows.fn).toBe(0)
  })

  it('falla con una salida inventada incorrecta', () => {
    const source = gold()
    const candidate: ScheduleDoc = {
      tables: [
        { key: 'T1', outcome: 'failed' },
        { key: 'T2', outcome: 'failed' },
      ],
      visits: [
        { key: 'A', tableKey: 'T1', printedId: 'V1', label: 'Visita 1', timing: timing(1, 'day'), window: { before: 2, after: 2, unit: 'day' }, type: 'standard', attributes: { fasting: true, onSite: true, armOnly: null } },
        { key: 'B', tableKey: 'T1', printedId: 'VISITA-INVENTADA', label: 'Inventada', timing: timing(1, 'day'), window: { before: 2, after: 2, unit: 'day' }, type: 'standard', attributes: { fasting: true, onSite: true, armOnly: 'A' } },
        { key: 'Z', tableKey: 'T1', printedId: 'ZZ', label: 'Extra', timing: timing(99, 'day'), window: null, type: 'standard', attributes: { fasting: null, onSite: null, armOnly: null } },
      ],
      procedures: [
        { key: 'P1', label: 'Signos vitales', kind: 'procedure' },
        { key: 'P4', label: 'Panel de laboratorio C', kind: 'procedure' },
        { key: 'X', label: 'Biopsia inventada', kind: 'procedure' },
      ],
      cells: [
        { visitKey: 'A', procedureKey: 'P1', mark: 'x', noteRefs: [], conditions: [{ kind: 'arm', expr: 'brazo Z' }] },
        { visitKey: 'A', procedureKey: 'P4', mark: 'x', noteRefs: [], conditions: [] },
        { visitKey: 'A', procedureKey: 'X', mark: 'x', noteRefs: ['9'], conditions: [] },
      ],
      notes: [],
      outOfTableRules: [],
      inconsistencies: [{ kind: 'duplicated_row' }, { kind: 'onsite_missing_with_lab' }],
      meta: { costUsd: 0.2, latencyS: 40 },
    }
    const report = scoreSchedule(source, candidate)
    expect(report.visits).toEqual({ tp: 2, fp: 1, fn: 1 })
    expect(report.printedIds.exact).toBe(1)
    expect(report.printedIds.inexact).toBe(1)
    expect(report.printedIds.invented).toBe(2)
    expect(report.windows.fn).toBeGreaterThan(0)
    expect(report.cells.fn).toBeGreaterThan(0)
    expect(report.cells.fp).toBeGreaterThan(0)
    expect(report.prnCells).toEqual({ tp: 0, fp: 0, fn: 1 })
    expect(report.notes.fn).toBeGreaterThan(0)
    expect(report.conditions.arm.fn).toBe(1)
    expect(report.conditions.fasting.fn).toBe(1)
    expect(report.inconsistencies).toEqual({ tp: 1, fp: 1, fn: 1 })
    expect(report.failedTables.tp).toBe(1)
    expect(report.failedTables.fp).toBe(1)
    expect(report.costUsd).toBe(0.2)
    const wrong = report.visits.fp + report.visits.fn + report.cells.fp + report.cells.fn + report.prnCells.fn
    expect(wrong).toBeGreaterThan(0)
  })

  it('usa alias y no cruza paneles hermanos cuando el texto exacto está', () => {
    const source = gold()
    const candidate = clone(source)
    const ecg = candidate.procedures?.find((item) => item.key === 'P2')
    ecg!.label = 'electrocardiograma'
    const report = scoreSchedule(source, candidate)
    expect(report.cells.fn).toBe(0)
    expect(report.cells.tp).toBe(5)
    const swapped = clone(source)
    const panel = swapped.procedures?.find((item) => item.key === 'P4')
    panel!.label = 'Talla'
    const missed = scoreSchedule(source, swapped)
    expect(missed.cells.fn).toBeGreaterThan(0)
    expect(similarity('Panel de laboratorio A', 'Panel de laboratorio B')).toBeGreaterThanOrEqual(0.85)
  })

  it('en modo private no quedan etiquetas ni textos', () => {
    const report = toPrivate(scoreSchedule(gold(), gold()))
    const dumped = JSON.stringify(report)
    expect(dumped).not.toContain('Signos')
    expect(dumped).not.toContain('Cronograma')
    expect(dumped).not.toContain('brazo')
    expect(dumped).not.toContain('T1')
    expect(dumped).not.toContain('hybrid')
    expect(dumped).not.toContain('duplicated_row')
    expect(dumped).not.toContain('follow_up')
    const allowed = new Set([
      'visits', 'tp', 'fp', 'fn', 'printedIdsExact', 'printedIdsInexact', 'printedIdsInvented',
      'windows', 'types', 'attributes', 'cells', 'cellsByTable', 'cellsByVisitType', 'prnCells',
      'notes', 'conditions', 'inconsistencies', 'failedTables', 'costUsd', 'latencyS',
    ])
    const walk = (value: unknown): void => {
      if (value === null || typeof value === 'number') return
      expect(typeof value).not.toBe('string')
      if (Array.isArray(value)) {
        value.forEach(walk)
        return
      }
      expect(typeof value).toBe('object')
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        expect(allowed.has(key)).toBe(true)
        walk(inner)
      }
    }
    walk(report)
    expect(report.cellsByVisitType).toHaveLength(VISIT_TYPES.length)
    expect(report.conditions).toHaveLength(CONDITION_KINDS.length)
    expect(report.cellsByTable).toHaveLength(2)
  })

  it('empareja la semana 12 del gold con el día 85 del candidato', () => {
    const source = gold()
    const rescue = source.visits?.find((visit) => visit.key === 'C')
    rescue!.printedId = 'S12'
    const candidate = clone(source)
    const found = candidate.visits?.find((visit) => visit.key === 'C')
    found!.timing = timing(85, 'day')
    found!.printedId = 'Dia 85'
    const report = scoreSchedule(source, candidate)
    expect(report.visits).toEqual({ tp: 3, fp: 0, fn: 0 })
    expect(report.printedIds.inexact).toBe(1)
  })

  it('alinea tablas por páginas aunque el candidato las llame distinto', () => {
    const source = gold()
    const candidate = clone(source)
    candidate.tables = [
      { key: 'A', pages: [2], outcome: 'complete', reasons: [] },
      { key: 'B', pages: [3], outcome: 'complete', reasons: [] },
    ]
    for (const visit of candidate.visits ?? []) {
      visit.tableKey = visit.tableKey === 'T1' ? 'A' : 'B'
    }
    for (const note of candidate.notes ?? []) {
      note.tableKey = note.tableKey === 'T1' ? 'A' : 'B'
    }
    const report = scoreSchedule(source, candidate)
    expect(report.visits).toEqual({ tp: 3, fp: 0, fn: 0 })
    expect(report.notes).toEqual({ tp: 2, fp: 0, fn: 0 })
    expect(report.failedTables).toEqual({ tp: 0, fp: 0, fn: 0 })
  })

  it('mide el tipo aparte: una visita híbrida mal clasificada sigue emparejando', () => {
    const source = gold()
    const candidate = clone(source)
    const visit = candidate.visits?.find((item) => item.key === 'A')
    visit!.type = 'hybrid'
    const report = scoreSchedule(source, candidate)
    expect(report.visits).toEqual({ tp: 3, fp: 0, fn: 0 })
    expect(report.types).toEqual({ tp: 2, fp: 1, fn: 1 })
  })

  it('empareja un evento sin tiempo por el id impreso, no por el tipo', () => {
    const source = gold()
    source.visits?.push({
      key: 'E', tableKey: 'T1', printedId: 'VDT', label: 'Discontinuación',
      timing: timing(null, null, 'event'), window: null, type: 'early_termination',
      attributes: { fasting: null, onSite: null, armOnly: null },
    })
    const candidate = clone(source)
    const event = candidate.visits?.find((visit) => visit.key === 'E')
    event!.printedId = 'vdt'
    event!.type = 'standard'
    const report = scoreSchedule(source, candidate)
    expect(report.visits).toEqual({ tp: 4, fp: 0, fn: 0 })
    expect(report.types).toEqual({ tp: 3, fp: 1, fn: 1 })
  })

  it('adapta la salida plana del extractor actual y la califica', () => {
    const source: ScheduleDoc = {
      tables: [{ key: 'T1', pages: [6, 7], outcome: 'complete' }],
      visits: [
        { key: 'A', tableKey: 'T1', printedId: 'V1', label: 'Día 1', timing: timing(1, 'day'), window: { before: 2, after: 2, unit: 'day' }, type: 'standard', attributes: { fasting: null, onSite: null, armOnly: null } },
      ],
      procedures: [{ key: 'P1', label: 'Peso', kind: 'procedure' }],
      cells: [{ visitKey: 'A', procedureKey: 'P1', mark: 'x', noteRefs: [], conditions: [] }],
      inconsistencies: [],
    }
    const adapted = adaptLegacyVisits({
      visits: [{ name: 'V1', label: 'Día 1', day: 1, windowDays: 2, procedures: ['Peso'], sourcePages: [6] }],
    }, source)
    const report = scoreSchedule(source, adapted)
    expect(report.visits).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(report.cells).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(report.windows).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(report.failedTables.fn).toBe(0)
  })
})
