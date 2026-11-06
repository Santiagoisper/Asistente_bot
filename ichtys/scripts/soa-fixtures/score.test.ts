import { describe, expect, it } from 'vitest'
import {
  CONDITION_KINDS,
  VISIT_TYPES,
  adaptLegacyVisits,
  alignTables,
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
    expect(report.procedureWindows).toEqual({ tp: 0, fp: 0, fn: 0 })
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

  it('empareja la celda por tabla, visita y etiqueta aunque la clave del procedimiento cambie', () => {
    const shared: ScheduleDoc = {
      tables: [
        { key: 'T1', pages: [2], outcome: 'complete', reasons: [] },
        { key: 'T2', pages: [3], outcome: 'complete', reasons: [] },
      ],
      visits: [
        { key: 'A', tableKey: 'T1', printedId: 'V1', timing: timing(1, 'day'), window: null, type: 'standard' },
        { key: 'C', tableKey: 'T2', printedId: 'V2', timing: timing(8, 'day'), window: null, type: 'standard' },
      ],
      procedures: [
        { key: 'P', label: 'Signos vitales', aliases: ['vitales'], conditions: [] },
      ],
      cells: [
        { visitKey: 'A', procedureKey: 'P', mark: 'x', noteRefs: ['1'], conditions: [{ kind: 'arm', expr: 'brazo A' }] },
        { visitKey: 'C', procedureKey: 'P', mark: 'x', noteRefs: [], conditions: [] },
      ],
      notes: [{ ref: '1', tableKey: 'T1', text: 'nota', conditions: [] }],
    }
    const split = clone(shared)
    split.procedures = [
      { key: 'P-T1', label: 'Signos vitales', conditions: [] },
      { key: 'P-T2', label: 'vitales', conditions: [] },
    ]
    split.cells = [
      { visitKey: 'A', procedureKey: 'P-T1', mark: 'x', noteRefs: ['1'], conditions: [{ kind: 'arm', expr: 'brazo A' }] },
      { visitKey: 'C', procedureKey: 'P-T2', mark: 'x', noteRefs: [], conditions: [] },
    ]
    const splitAgainstShared = scoreSchedule(shared, split)
    expect(splitAgainstShared.cells).toEqual({ tp: 2, fp: 0, fn: 0 })
    expect(splitAgainstShared.notes).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(splitAgainstShared.conditions.arm).toEqual({ tp: 1, fp: 0, fn: 0 })

    const perTable = clone(shared)
    perTable.procedures = [
      { key: 'P-T1', label: 'Signos vitales', conditions: [] },
      { key: 'P-T2', label: 'Signos vitales', conditions: [] },
    ]
    perTable.cells = [
      { visitKey: 'A', procedureKey: 'P-T1', mark: 'x', noteRefs: ['1'], conditions: [{ kind: 'arm', expr: 'brazo A' }] },
      { visitKey: 'C', procedureKey: 'P-T2', mark: 'x', noteRefs: [], conditions: [] },
    ]
    const sharedAgainstSplit = scoreSchedule(perTable, shared)
    expect(sharedAgainstSplit.cells).toEqual({ tp: 2, fp: 0, fn: 0 })
    expect(sharedAgainstSplit.notes).toEqual({ tp: 1, fp: 0, fn: 0 })

    const wrong = clone(split)
    wrong.procedures = [
      { key: 'P-T1', label: 'Signos vitales', conditions: [] },
      { key: 'P-T2', label: 'Talla', conditions: [] },
    ]
    const missed = scoreSchedule(shared, wrong)
    expect(missed.cells).toEqual({ tp: 1, fp: 1, fn: 1 })
  })

  it('no cruza paneles hermanos solo por similitud', () => {
    const source = gold()
    source.procedures = [
      { key: 'PA', label: 'Panel de laboratorio A', kind: 'procedure', conditions: [] },
      { key: 'PB', label: 'Panel de laboratorio B', kind: 'procedure', conditions: [] },
    ]
    source.cells = [
      { visitKey: 'A', procedureKey: 'PA', mark: 'x', noteRefs: [], conditions: [] },
    ]
    const candidate = clone(source)
    candidate.procedures = [
      { key: 'PX', label: 'Panel de laboratorio B', kind: 'procedure', conditions: [] },
    ]
    candidate.cells = [
      { visitKey: 'A', procedureKey: 'PX', mark: 'x', noteRefs: [], conditions: [] },
    ]
    expect(similarity('Panel de laboratorio A', 'Panel de laboratorio B')).toBeGreaterThanOrEqual(0.85)
    const report = scoreSchedule(source, candidate)
    expect(report.cells).toEqual({ tp: 0, fp: 1, fn: 1 })
  })

  it('empareja inconsistencias por kind y tabla alineada, uno a uno', () => {
    const source = gold()
    source.tables = [
      { key: 'T1', pages: [13, 20], outcome: 'complete', reasons: [] },
      { key: 'T2', pages: [40, 62], outcome: 'complete', reasons: [] },
    ]
    source.inconsistencies = [
      { kind: 'duplicated_row', description: 'Panel de laboratorio A está repetido.', pages: [13] },
      { kind: 'duplicated_row', description: 'Otra fila repetida.', pages: [13] },
    ]
    const otherTable = clone(source)
    otherTable.inconsistencies = [
      { kind: 'duplicated_row', description: 'T2:R9/R10:label_repetido_misma_tira', pages: [40] },
    ]
    expect(scoreSchedule(source, otherTable).inconsistencies).toEqual({ tp: 0, fp: 1, fn: 2 })
    const one = clone(source)
    one.tables = [{ key: 'ZZ', pages: [13, 20], outcome: 'complete', reasons: [] }]
    one.inconsistencies = [
      { kind: 'duplicated_row', description: 'ZZ:R44/R139:label_repetido_misma_tira', pages: [20] },
    ]
    expect(scoreSchedule(source, one).inconsistencies).toEqual({ tp: 1, fp: 0, fn: 1 })
  })

  it('la ventana propia solo es acierto en la celda que cita la nota', () => {
    const source: ScheduleDoc = {
      tables: [{ key: 'T1', pages: [2], outcome: 'complete', reasons: [] }],
      visits: [
        { key: 'A', tableKey: 'T1', printedId: 'V1', label: 'Visita 1', timing: timing(1, 'day'), window: null, type: 'standard', attributes: null },
        { key: 'C', tableKey: 'T1', printedId: 'V8', label: 'Visita 8', timing: timing(8, 'day'), window: null, type: 'standard', attributes: null },
      ],
      procedures: [
        { key: 'CONS', label: 'Consentimiento informado', conditions: [] },
        { key: 'DOSIS', label: 'Entre 1 y 2 horas después de la dosis', conditions: [] },
      ],
      cells: [
        { visitKey: 'A', procedureKey: 'CONS', mark: 'x', noteRefs: ['1'], conditions: [], procedureWindow: { before: 4, after: 2, unit: 'week' } },
        { visitKey: 'C', procedureKey: 'DOSIS', mark: 'x', noteRefs: [], conditions: [], procedureWindow: null },
      ],
      notes: [{ ref: '1', tableKey: 'T1', text: 'Ventana propia' }],
      inconsistencies: [],
    }
    const planted = clone(source)
    planted.cells = [
      { visitKey: 'A', procedureKey: 'CONS', mark: 'x', noteRefs: ['1'], conditions: [], procedureWindow: null },
      { visitKey: 'C', procedureKey: 'DOSIS', mark: 'x', noteRefs: [], conditions: [], procedureWindow: { before: 4, after: 2, unit: 'week' } },
    ]
    expect(scoreSchedule(source, planted).procedureWindows).toEqual({ tp: 0, fp: 1, fn: 1 })
    const sameCell = clone(source)
    expect(scoreSchedule(source, sameCell).procedureWindows).toEqual({ tp: 1, fp: 0, fn: 0 })
    const wrongValue = clone(source)
    wrongValue.cells![0]!.procedureWindow = { before: 2, after: 2, unit: 'day' }
    expect(scoreSchedule(source, wrongValue).procedureWindows).toEqual({ tp: 0, fp: 1, fn: 1 })
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
      'notes', 'conditions', 'inconsistencies', 'procedureWindows', 'failedTables', 'costUsd', 'latencyS',
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

  it('desempata dos tablas de las mismas páginas por el rango vertical de las visitas', () => {
    const tables = [
      { key: 'T1', pages: [3, 4] },
      { key: 'T2', pages: [3, 4] },
    ]
    const high = [{ page: 3, y0: 500, y1: 520 }]
    const low = [{ page: 3, y0: 400, y1: 420 }]
    const geometry = {
      gold: new Map([['T1', high], ['T2', low]]),
      candidate: new Map([['T1', low], ['T2', high]]),
    }
    const map = alignTables(tables, tables, geometry)
    expect(map.get('T1')).toBe('T2')
    expect(map.get('T2')).toBe('T1')
    const sameName = alignTables(tables, tables, {
      gold: new Map([['T1', high], ['T2', low]]),
      candidate: new Map([['T1', high], ['T2', low]]),
    })
    expect(sameName.get('T1')).toBe('T1')
    expect(sameName.get('T2')).toBe('T2')
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
