/**
 * __tests__/official-score-shapes.ts — SOLO los TIPOS del calificador oficial
 * (scripts/soa-fixtures/score.ts, PR #68), replicados acá para el tsc de este
 * paquete:
 *
 * El oficial importa `packages/clinical/visit-window.ts` CON extensión .ts
 * (exigido por su runner con node --experimental-strip-types), y tsc de este
 * paquete no tiene allowImportingTsExtensions: seguir el import estático
 * rompe el typecheck (TS5097) y scripts/soa-fixtures/** está fuera del scope
 * de esta misión. Por eso los tipos viven acá y el VALOR se carga por import
 * dinámico en los tests — la LÓGICA del calificador es siempre la del
 * oficial, nunca una reimplementación (K8).
 *
 * Si el oficial cambia su shape, esto debe seguirlo (drift visible en los
 * tests: campos que dejan de existir rompen las aserciones).
 */

export interface Counts {
  tp: number
  fp: number
  fn: number
}

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

// ── Shapes del ScheduleDoc del oficial (los que esta suite toca) ──────────

export interface TableRec {
  key: string
  pages?: number[]
  outcome?: 'complete' | 'partial' | 'failed'
  reasons?: string[]
}

export interface VisitRec {
  key: string
  tableKey: string | null
  printedId: string | null
  timing: { kind: string; value: number | null; unit: string | null }
  window: { before: number | null; after: number | null; unit: string | null } | null
  type: string
  attributes?: { fasting?: boolean | null; onSite?: boolean | null; armOnly?: string | null } | null
}

export interface ConditionRec {
  kind: string
  expr: string
}

export interface ProcedureRec {
  key: string
  label: string
  conditions?: ConditionRec[]
}

export interface CellRec {
  visitKey: string
  procedureKey: string
  mark: string
  noteRefs?: string[]
  conditions?: ConditionRec[]
}

export interface NoteRec {
  ref: string
  tableKey: string
  text?: string
  page?: number
  conditions?: ConditionRec[]
}

export interface RuleRec {
  text: string
  page?: number
  conditions?: ConditionRec[]
}

export interface ScheduleDoc {
  tables?: TableRec[]
  visits?: VisitRec[]
  procedures?: ProcedureRec[]
  cells?: CellRec[]
  notes?: NoteRec[]
  outOfTableRules?: RuleRec[]
  inconsistencies?: Array<{ kind: string }>
}
