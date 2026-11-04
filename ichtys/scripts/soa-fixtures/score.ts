/**
 * Calificador del cronograma (ADR-10 §6 y ADR-10-fixtures §7).
 *
 * Visitas: (tableKey, timing.value, timing.unit, type). Empate → printedId
 * normalizado. No usa posición. Procedimientos: etiqueta normalizada, alias
 * del gold, o similitud ≥ 0,85. Salida: solo contadores. `--private` no
 * imprime etiquetas ni texto.
 */
import { readFileSync } from 'node:fs'

export const SIMILARITY_THRESHOLD = 0.85

export const VISIT_TYPES = [
  'standard', 'pk_only', 'dispense_only', 'hybrid', 'remote', 'screening',
  'end_of_study', 'early_termination', 'unscheduled', 'follow_up',
] as const

export const CONDITION_KINDS = [
  'population', 'arm', 'dose_timing', 'consent', 'country', 'event',
  'dependency', 'order', 'fasting',
] as const

export type VisitType = (typeof VISIT_TYPES)[number]
export type ConditionKind = (typeof CONDITION_KINDS)[number]
export type Mark = 'x' | 'prn_range' | 'conditional'

export interface Timing {
  kind: 'scheduled' | 'event' | 'recurrent'
  value: number | null
  unit: 'day' | 'week' | null
  anchor: string | null
  recurrence: { every: number; unit: 'week'; until: string | null } | null
}

export interface WindowSpec {
  before: number | null
  after: number | null
  unit: 'day' | 'week' | 'hour' | null
}

export interface Condition {
  kind: ConditionKind
  expr: string
}

export interface TableRec {
  key: string
  title?: string
  pages?: number[]
  outcome?: 'complete' | 'partial' | 'failed'
  reasons?: string[]
}

export interface VisitRec {
  key: string
  tableKey: string | null
  printedId: string | null
  label?: string | null
  timing: Timing
  window: WindowSpec | null
  type: VisitType
  attributes?: { fasting?: boolean | null; onSite?: boolean | null; armOnly?: string | null } | null
}

export interface ProcedureRec {
  key: string
  label: string
  kind?: 'procedure' | 'narrative_rule'
  aliases?: string[]
  conditions?: Condition[]
}

export interface CellRec {
  visitKey: string
  procedureKey: string
  mark: Mark
  noteRefs?: string[]
  conditions?: Condition[]
}

export interface NoteRec {
  ref: string
  tableKey: string
  text?: string
  page?: number
  conditions?: Condition[]
}

export interface RuleRec {
  text: string
  page?: number
  conditions?: Condition[]
}

export interface InconsistencyRec {
  kind: string
}

export interface ScheduleDoc {
  tables?: TableRec[]
  visits?: VisitRec[]
  procedures?: ProcedureRec[]
  procedureAliases?: Array<{ alias: string; procedureKey: string }>
  cells?: CellRec[]
  notes?: NoteRec[]
  outOfTableRules?: RuleRec[]
  inconsistencies?: InconsistencyRec[]
  meta?: { costUsd?: number | null; latencyS?: number | null }
}

export interface Counts { tp: number; fp: number; fn: number }

export interface ScoreReport {
  visits: Counts
  printedIds: { exact: number; inexact: number; invented: number }
  windows: Counts
  types: Counts
  attributes: Counts
  cells: Counts
  cellsByTable: Record<string, Counts>
  cellsByVisitType: Record<string, Counts>
  prnCells: Counts
  notes: Counts
  conditions: Record<string, Counts>
  inconsistencies: Counts
  failedTables: Counts
  costUsd: number | null
  latencyS: number | null
}

export interface PrivateScoreReport {
  visits: Counts
  printedIdsExact: number
  printedIdsInexact: number
  printedIdsInvented: number
  windows: Counts
  types: Counts
  attributes: Counts
  cells: Counts
  cellsByTable: Counts[]
  cellsByVisitType: Counts[]
  prnCells: Counts
  notes: Counts
  conditions: Counts[]
  inconsistencies: Counts
  failedTables: Counts
  costUsd: number | null
  latencyS: number | null
}

interface LegacyVisit {
  name: string
  label?: string | null
  day: number | null
  windowDays: number | null
  procedures: string[]
  sourcePages?: number[]
}

export function emptyCounts(): Counts {
  return { tp: 0, fp: 0, fn: 0 }
}

export function normalizeLabel(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function similarity(a: string, b: string): number {
  const left = normalizeLabel(a)
  const right = normalizeLabel(b)
  if (left === right) return left.length === 0 ? 0 : 1
  const denom = Math.max(left.length, right.length)
  if (denom === 0) return 0
  const row = new Array<number>(right.length + 1)
  for (let j = 0; j <= right.length; j += 1) row[j] = j
  for (let i = 1; i <= left.length; i += 1) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= right.length; j += 1) {
      const cur = row[j]!
      const cost = left.charCodeAt(i - 1) === right.charCodeAt(j - 1) ? 0 : 1
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost)
      prev = cur
    }
  }
  return 1 - row[right.length]! / denom
}

function bumpKind(into: Record<string, Counts>, kind: string, field: keyof Counts): void {
  const bucket = into[kind] ?? (into[kind] = emptyCounts())
  bucket[field] += 1
}

function foldConditions(into: Record<string, Counts>, gold: Condition[] | undefined, candidate: Condition[] | undefined): void {
  const used = new Set<number>()
  const cand = candidate ?? []
  for (const item of gold ?? []) {
    let found = -1
    let best = -1
    cand.forEach((other, index) => {
      if (used.has(index) || other.kind !== item.kind) return
      const score = similarity(item.expr, other.expr)
      if (score >= SIMILARITY_THRESHOLD && score > best) {
        best = score
        found = index
      }
    })
    if (found >= 0) {
      used.add(found)
      bumpKind(into, item.kind, 'tp')
    } else {
      bumpKind(into, item.kind, 'fn')
    }
  }
  cand.forEach((other, index) => {
    if (!used.has(index)) bumpKind(into, other.kind, 'fp')
  })
}

function visitIdentity(visit: VisitRec): string {
  const value = visit.timing?.value ?? null
  const unit = visit.timing?.unit ?? null
  return `${visit.tableKey ?? ''}|${value === null ? 'null' : String(value)}|${unit ?? 'null'}|${visit.type}`
}

function normId(printedId: string | null | undefined): string {
  if (printedId == null) return ''
  return normalizeLabel(printedId)
}

function matchVisits(gold: VisitRec[], candidate: VisitRec[]) {
  const pools = new Map<string, VisitRec[]>()
  for (const visit of gold) {
    const list = pools.get(visitIdentity(visit)) ?? []
    list.push(visit)
    pools.set(visitIdentity(visit), list)
  }
  const pairs: Array<{ gold: VisitRec; candidate: VisitRec }> = []
  const unmatchedCand: VisitRec[] = []
  for (const visit of candidate) {
    const pool = pools.get(visitIdentity(visit))
    if (!pool || pool.length === 0) {
      unmatchedCand.push(visit)
      continue
    }
    const wanted = normId(visit.printedId)
    let index = pool.findIndex((item) => normId(item.printedId) === wanted)
    if (index < 0) index = 0
    pairs.push({ gold: pool.splice(index, 1)[0]!, candidate: visit })
  }
  return { pairs, unmatchedGold: [...pools.values()].flat(), unmatchedCand }
}

function matchProcedures(gold: ProcedureRec[], candidate: ProcedureRec[], aliasList: Array<{ alias: string; procedureKey: string }>) {
  const aliases = new Map<string, string[]>()
  for (const procedure of gold) aliases.set(procedure.key, [...(procedure.aliases ?? [])])
  for (const alias of aliasList) {
    const list = aliases.get(alias.procedureKey) ?? []
    list.push(alias.alias)
    aliases.set(alias.procedureKey, list)
  }
  const ranked: Array<{ gold: ProcedureRec; candidate: ProcedureRec; score: number }> = []
  for (const procedure of gold) {
    for (const other of candidate) {
      const normalized = normalizeLabel(other.label)
      const aliasHit = (aliases.get(procedure.key) ?? []).some((alias) => normalizeLabel(alias) === normalized)
      const score = aliasHit ? 1 : similarity(other.label, procedure.label)
      if (score >= SIMILARITY_THRESHOLD) ranked.push({ gold: procedure, candidate: other, score })
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.gold.key.localeCompare(b.gold.key) || a.candidate.key.localeCompare(b.candidate.key))
  const usedG = new Set<string>()
  const usedC = new Set<string>()
  const pairs: Array<{ gold: ProcedureRec; candidate: ProcedureRec }> = []
  for (const pair of ranked) {
    if (usedG.has(pair.gold.key) || usedC.has(pair.candidate.key)) continue
    usedG.add(pair.gold.key)
    usedC.add(pair.candidate.key)
    pairs.push({ gold: pair.gold, candidate: pair.candidate })
  }
  return {
    pairs,
    unmatchedGold: gold.filter((item) => !usedG.has(item.key)),
    unmatchedCand: candidate.filter((item) => !usedC.has(item.key)),
  }
}

function windowsEqual(a: WindowSpec | null | undefined, b: WindowSpec | null | undefined): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return a.before === b.before && a.after === b.after && a.unit === b.unit
}

function attr(visit: VisitRec, field: 'fasting' | 'onSite' | 'armOnly'): boolean | string | null {
  const value = visit.attributes?.[field]
  if (field === 'armOnly') return value == null || value === '' ? null : normalizeLabel(String(value))
  return value ?? null
}

function take(bag: Map<string, number>, key: string): boolean {
  const left = bag.get(key) ?? 0
  if (left <= 0) return false
  if (left === 1) bag.delete(key)
  else bag.set(key, left - 1)
  return true
}

export function scoreSchedule(gold: ScheduleDoc, candidate: ScheduleDoc): ScoreReport {
  const goldVisits = gold.visits ?? []
  const candVisits = candidate.visits ?? []
  const visitMatch = matchVisits(goldVisits, candVisits)
  const visits: Counts = {
    tp: visitMatch.pairs.length,
    fp: visitMatch.unmatchedCand.length,
    fn: visitMatch.unmatchedGold.length,
  }

  const printedIds = { exact: 0, inexact: 0, invented: 0 }
  const goldIdsByTable = new Map<string, Set<string>>()
  for (const visit of goldVisits) {
    const id = normId(visit.printedId)
    if (!id) continue
    const set = goldIdsByTable.get(visit.tableKey ?? '') ?? new Set<string>()
    set.add(id)
    goldIdsByTable.set(visit.tableKey ?? '', set)
  }
  const windows = emptyCounts()
  const types = emptyCounts()
  const attributes = emptyCounts()
  for (const pair of visitMatch.pairs) {
    if (normId(pair.gold.printedId) === normId(pair.candidate.printedId)) printedIds.exact += 1
    else printedIds.inexact += 1
    if (windowsEqual(pair.gold.window, pair.candidate.window)) windows.tp += 1
    else {
      windows.fp += 1
      windows.fn += 1
    }
    types.tp += 1
    for (const field of ['fasting', 'onSite', 'armOnly'] as const) {
      if (attr(pair.gold, field) === attr(pair.candidate, field)) attributes.tp += 1
      else {
        attributes.fp += 1
        attributes.fn += 1
      }
    }
  }
  for (const visit of candVisits) {
    const id = normId(visit.printedId)
    if (!id) continue
    const known = goldIdsByTable.get(visit.tableKey ?? '')
    if (!known || !known.has(id)) printedIds.invented += 1
  }

  const procMatch = matchProcedures(gold.procedures ?? [], candidate.procedures ?? [], gold.procedureAliases ?? [])
  const goldVisitByKey = new Map(goldVisits.map((visit) => [visit.key, visit]))
  const visitGoldOfCand = new Map(visitMatch.pairs.map((pair) => [pair.candidate.key, pair.gold.key]))
  const procGoldOfCand = new Map(procMatch.pairs.map((pair) => [pair.candidate.key, pair.gold.key]))
  const matchedGoldVisits = new Set(visitMatch.pairs.map((pair) => pair.gold.key))
  const matchedGoldProcs = new Set(procMatch.pairs.map((pair) => pair.gold.key))

  const cells = emptyCounts()
  const prnCells = emptyCounts()
  const cellsByTable: Record<string, Counts> = {}
  const cellsByVisitType: Record<string, Counts> = {}
  for (const table of gold.tables ?? []) cellsByTable[table.key] = emptyCounts()
  for (const type of VISIT_TYPES) cellsByVisitType[type] = emptyCounts()

  const record = (mark: Mark, tableKey: string, visitType: string, field: keyof Counts) => {
    const target = mark === 'prn_range' ? prnCells : cells
    target[field] += 1
    if (mark === 'prn_range') return
    if (tableKey && cellsByTable[tableKey]) cellsByTable[tableKey]![field] += 1
    if (visitType && cellsByVisitType[visitType]) cellsByVisitType[visitType]![field] += 1
  }

  const goldBags = new Map<string, number>()
  for (const cell of gold.cells ?? []) {
    const visit = goldVisitByKey.get(cell.visitKey)
    if (!visit || !matchedGoldVisits.has(visit.key) || !matchedGoldProcs.has(cell.procedureKey)) continue
    const key = `${visit.key}|${cell.procedureKey}|${cell.mark}`
    goldBags.set(key, (goldBags.get(key) ?? 0) + 1)
  }
  for (const cell of candidate.cells ?? []) {
    const goldVisitKey = visitGoldOfCand.get(cell.visitKey)
    const goldProcKey = procGoldOfCand.get(cell.procedureKey)
    const visit = goldVisitKey ? goldVisitByKey.get(goldVisitKey) : undefined
    const key = goldVisitKey && goldProcKey ? `${goldVisitKey}|${goldProcKey}|${cell.mark}` : ''
    if (visit && key && take(goldBags, key)) record(cell.mark, visit.tableKey ?? '', visit.type, 'tp')
    else record(cell.mark, visit?.tableKey ?? '', visit?.type ?? '', 'fp')
  }
  for (const [key, left] of goldBags) {
    const [visitKey, , mark] = key.split('|') as [string, string, Mark]
    const visit = goldVisitByKey.get(visitKey)
    for (let i = 0; i < left; i += 1) record(mark, visit?.tableKey ?? '', visit?.type ?? '', 'fn')
  }
  for (const cell of gold.cells ?? []) {
    const visit = goldVisitByKey.get(cell.visitKey)
    if (visit && matchedGoldVisits.has(visit.key) && matchedGoldProcs.has(cell.procedureKey)) continue
    record(cell.mark, visit?.tableKey ?? '', visit?.type ?? '', 'fn')
  }

  const notes = emptyCounts()
  const noteBag = new Map<string, number>()
  const remember = (bag: Map<string, number>, cellVisit: string, cellProc: string, refs: string[] | undefined) => {
    for (const ref of refs ?? []) {
      const key = `${cellVisit}|${cellProc}|${ref.trim()}`
      bag.set(key, (bag.get(key) ?? 0) + 1)
    }
  }
  for (const cell of gold.cells ?? []) {
    if (!matchedGoldVisits.has(cell.visitKey) || !matchedGoldProcs.has(cell.procedureKey)) {
      notes.fn += (cell.noteRefs ?? []).length
      continue
    }
    remember(noteBag, cell.visitKey, cell.procedureKey, cell.noteRefs)
  }
  for (const cell of candidate.cells ?? []) {
    const goldVisitKey = visitGoldOfCand.get(cell.visitKey)
    const goldProcKey = procGoldOfCand.get(cell.procedureKey)
    if (!goldVisitKey || !goldProcKey) {
      notes.fp += (cell.noteRefs ?? []).length
      continue
    }
    for (const ref of cell.noteRefs ?? []) {
      const key = `${goldVisitKey}|${goldProcKey}|${ref.trim()}`
      if (take(noteBag, key)) notes.tp += 1
      else notes.fp += 1
    }
  }
  for (const left of noteBag.values()) notes.fn += left

  const conditions: Record<string, Counts> = {}
  for (const kind of CONDITION_KINDS) conditions[kind] = emptyCounts()
  const candByCell = new Map<string, CellRec[]>()
  for (const cell of candidate.cells ?? []) {
    const goldVisitKey = visitGoldOfCand.get(cell.visitKey)
    const goldProcKey = procGoldOfCand.get(cell.procedureKey)
    if (!goldVisitKey || !goldProcKey) {
      foldConditions(conditions, [], cell.conditions)
      continue
    }
    const key = `${goldVisitKey}|${goldProcKey}|${cell.mark}`
    const list = candByCell.get(key) ?? []
    list.push(cell)
    candByCell.set(key, list)
  }
  for (const cell of gold.cells ?? []) {
    const aligned = matchedGoldVisits.has(cell.visitKey) && matchedGoldProcs.has(cell.procedureKey)
    const key = `${cell.visitKey}|${cell.procedureKey}|${cell.mark}`
    const pool = aligned ? candByCell.get(key) : undefined
    const other = pool && pool.length > 0 ? pool.shift() : undefined
    foldConditions(conditions, cell.conditions, other?.conditions ?? [])
  }
  for (const list of candByCell.values()) {
    for (const extra of list) foldConditions(conditions, [], extra.conditions)
  }
  for (const pair of procMatch.pairs) foldConditions(conditions, pair.gold.conditions, pair.candidate.conditions)
  for (const procedure of procMatch.unmatchedGold) foldConditions(conditions, procedure.conditions, [])
  for (const procedure of procMatch.unmatchedCand) foldConditions(conditions, [], procedure.conditions)

  const candNotes = new Map((candidate.notes ?? []).map((note) => [`${note.tableKey}|${note.ref.trim()}`, note]))
  const usedNotes = new Set<string>()
  for (const note of gold.notes ?? []) {
    const key = `${note.tableKey}|${note.ref.trim()}`
    const other = candNotes.get(key)
    if (other) usedNotes.add(key)
    foldConditions(conditions, note.conditions, other?.conditions ?? [])
  }
  for (const note of candidate.notes ?? []) {
    const key = `${note.tableKey}|${note.ref.trim()}`
    if (!usedNotes.has(key)) foldConditions(conditions, [], note.conditions)
  }

  const rulesG = gold.outOfTableRules ?? []
  const rulesC = candidate.outOfTableRules ?? []
  const ranked: Array<{ gi: number; ci: number; score: number }> = []
  rulesG.forEach((rule, gi) => {
    rulesC.forEach((other, ci) => {
      const score = similarity(rule.text, other.text)
      if (score >= SIMILARITY_THRESHOLD) ranked.push({ gi, ci, score })
    })
  })
  ranked.sort((a, b) => b.score - a.score)
  const usedG = new Set<number>()
  const usedC = new Set<number>()
  for (const item of ranked) {
    if (usedG.has(item.gi) || usedC.has(item.ci)) continue
    usedG.add(item.gi)
    usedC.add(item.ci)
    foldConditions(conditions, rulesG[item.gi]?.conditions, rulesC[item.ci]?.conditions)
  }
  rulesG.forEach((rule, index) => { if (!usedG.has(index)) foldConditions(conditions, rule.conditions, []) })
  rulesC.forEach((rule, index) => { if (!usedC.has(index)) foldConditions(conditions, [], rule.conditions) })

  const inconsistencies = emptyCounts()
  const goldKinds = new Map<string, number>()
  for (const item of gold.inconsistencies ?? []) goldKinds.set(item.kind, (goldKinds.get(item.kind) ?? 0) + 1)
  for (const item of candidate.inconsistencies ?? []) {
    if (take(goldKinds, item.kind)) inconsistencies.tp += 1
    else inconsistencies.fp += 1
  }
  for (const left of goldKinds.values()) inconsistencies.fn += left

  const failedTables = emptyCounts()
  const matchedByTable = new Map<string, number>()
  for (const pair of visitMatch.pairs) {
    const table = pair.gold.tableKey ?? ''
    matchedByTable.set(table, (matchedByTable.get(table) ?? 0) + 1)
  }
  const goldTableKeys = new Set((gold.tables ?? []).map((table) => table.key))
  for (const table of gold.tables ?? []) {
    const goldCount = goldVisits.filter((visit) => visit.tableKey === table.key).length
    const unread = goldCount > 0 && (matchedByTable.get(table.key) ?? 0) === 0
    const markedFailed = (candidate.tables ?? []).some((item) => item.key === table.key && item.outcome === 'failed')
    if (unread && markedFailed) failedTables.tp += 1
    else if (unread && !markedFailed) failedTables.fn += 1
    else if (!unread && markedFailed) failedTables.fp += 1
  }
  for (const table of candidate.tables ?? []) {
    if (!goldTableKeys.has(table.key) && table.outcome === 'failed') failedTables.fp += 1
  }

  return {
    visits, printedIds, windows, types, attributes, cells, cellsByTable, cellsByVisitType,
    prnCells, notes, conditions, inconsistencies, failedTables,
    costUsd: candidate.meta?.costUsd ?? null,
    latencyS: candidate.meta?.latencyS ?? null,
  }
}

export function toPrivate(report: ScoreReport): PrivateScoreReport {
  return {
    visits: report.visits,
    printedIdsExact: report.printedIds.exact,
    printedIdsInexact: report.printedIds.inexact,
    printedIdsInvented: report.printedIds.invented,
    windows: report.windows,
    types: report.types,
    attributes: report.attributes,
    cells: report.cells,
    cellsByTable: Object.keys(report.cellsByTable).sort().map((key) => report.cellsByTable[key]!),
    cellsByVisitType: VISIT_TYPES.map((type) => report.cellsByVisitType[type] ?? emptyCounts()),
    prnCells: report.prnCells,
    notes: report.notes,
    conditions: CONDITION_KINDS.map((kind) => report.conditions[kind] ?? emptyCounts()),
    inconsistencies: report.inconsistencies,
    failedTables: report.failedTables,
    costUsd: report.costUsd,
    latencyS: report.latencyS,
  }
}

function hasToken(normalized: string, token: string): boolean {
  return ` ${normalized} `.includes(` ${token} `)
}

export function inferLegacyVisitType(name: string, label: string | null | undefined): VisitType {
  const text = normalizeLabel(`${name} ${label ?? ''}`)
  if (hasToken(text, 'scr') || hasToken(text, 'screening') || hasToken(text, 'seleccion') || hasToken(text, 'sel')) return 'screening'
  if (text.includes('early termination') || text.includes('discontinuacion') || hasToken(text, 'vdt') || hasToken(text, 'et')) return 'early_termination'
  if (text.includes('fa seg') || text.includes('follow up') || text.includes('seguimiento') || hasToken(text, 'fu')) return 'follow_up'
  if (text.includes('end of study') || text.includes('fin de estudio') || hasToken(text, 'eos') || hasToken(text, 'vf') || hasToken(text, 'fa')) return 'end_of_study'
  if (text.includes('unscheduled') || text.includes('no programada') || hasToken(text, 'vnp')) return 'unscheduled'
  return 'standard'
}

/** Adapta la salida plana del extractor de 090e506 al contrato del cronograma. */
export function adaptLegacyVisits(spec: { visits?: LegacyVisit[] }, gold: ScheduleDoc): ScheduleDoc {
  const tables = gold.tables ?? []
  const visits: VisitRec[] = []
  const procedures: ProcedureRec[] = []
  const cells: CellRec[] = []
  const procKeyByLabel = new Map<string, string>()
  const procedureKey = (label: string): string => {
    const normalized = normalizeLabel(label)
    const existing = procKeyByLabel.get(normalized)
    if (existing) return existing
    const key = `L${procKeyByLabel.size + 1}`
    procKeyByLabel.set(normalized, key)
    procedures.push({ key, label, kind: 'procedure', conditions: [] })
    return key
  }
  for (const [index, visit] of (spec.visits ?? []).entries()) {
    const pages = new Set(visit.sourcePages ?? [])
    const hits = tables.filter((table) => (table.pages ?? []).some((page) => pages.has(page)))
    const tableKey = hits.length === 1 ? hits[0]!.key : tables.length === 1 ? tables[0]!.key : null
    const key = `LV${index + 1}`
    visits.push({
      key,
      tableKey,
      printedId: visit.name,
      label: visit.label ?? visit.name,
      timing: visit.day === null
        ? { kind: 'event', value: null, unit: null, anchor: null, recurrence: null }
        : { kind: 'scheduled', value: visit.day, unit: 'day', anchor: null, recurrence: null },
      window: visit.windowDays === null ? null : { before: visit.windowDays, after: visit.windowDays, unit: 'day' },
      type: inferLegacyVisitType(visit.name, visit.label),
      attributes: { fasting: null, onSite: null, armOnly: null },
    })
    for (const label of visit.procedures ?? []) {
      const trimmed = label.trim()
      if (!trimmed) continue
      cells.push({ visitKey: key, procedureKey: procedureKey(trimmed), mark: 'x', noteRefs: [], conditions: [] })
    }
  }
  return { tables: [], visits, procedures, cells, notes: [], outOfTableRules: [], inconsistencies: [] }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function main(): void {
  const args = process.argv.slice(2)
  let goldPath = ''
  let candidatePath = ''
  let priv = false
  let legacy = false
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--private') priv = true
    else if (arg === '--legacy') legacy = true
    else if (arg === '--gold') goldPath = args[++i] ?? ''
    else if (arg === '--candidate') candidatePath = args[++i] ?? ''
    else {
      process.stderr.write('uso: score.ts --gold <gold.json> --candidate <salida.json> [--private] [--legacy]\n')
      process.exit(2)
    }
  }
  if (!goldPath || !candidatePath) {
    process.stderr.write('uso: score.ts --gold <gold.json> --candidate <salida.json> [--private] [--legacy]\n')
    process.exit(2)
  }
  const gold = readJson(goldPath) as ScheduleDoc
  const raw = readJson(candidatePath) as ScheduleDoc & { visits?: LegacyVisit[] }
  const report = scoreSchedule(gold, legacy ? adaptLegacyVisits(raw, gold) : raw)
  process.stdout.write(`${JSON.stringify(priv ? toPrivate(report) : report)}\n`)
}

const invoked = process.argv[1]?.endsWith('score.ts') || process.argv[1]?.endsWith('score.js')
if (invoked) main()
