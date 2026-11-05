/**
 * Contrato de la cabina. Cuando el extractor nuevo exista, un adaptador
 * tiene que llenar estos mismos tipos. La demo no lee la base ni llama a un modelo.
 */

export type VisitType =
  | 'standard'
  | 'screening'
  | 'end_of_study'
  | 'early_termination'
  | 'unscheduled'
  | 'follow_up'
  | 'hybrid'

export type TimingUnit = 'day' | 'week'

export type ConditionKind =
  | 'population'
  | 'arm'
  | 'dose_timing'
  | 'consent'
  | 'fasting'
  | 'order'
  | 'dependency'
  | 'event'

export interface Condition {
  kind: ConditionKind
  /** dt2, erc, ic, wocbp, arm:A, arm:B, fasting. Si no se reconoce, la fila no aplica. */
  key: string
  expr: string
}

export interface WindowSpec {
  before: number
  after: number
  unit: 'day'
}

export interface VisitTiming {
  kind: 'scheduled' | 'event' | 'recurrent' | 'annual'
  value: number | null
  unit: TimingUnit | null
  anchor: 'v2'
  recurrence: { every: number; unit: 'week'; untilWeek: number | null } | null
}

export interface VisitAttributes {
  fasting: boolean | null
  onSite: boolean | null
  armOnly: 'A' | 'B' | null
}

export interface VisitDef {
  key: string
  tableKey: 'T1' | 'T2'
  tableTitle: string
  printedId: string
  label: string
  timing: VisitTiming
  window: WindowSpec | null
  type: VisitType
  attributes: VisitAttributes
  annual: boolean
}

export type SheetSection =
  | 'before'
  | 'day'
  | 'block'
  | 'undefined'
  | 'sponsor'
  | 'lab'
  | 'med'
  | 'consent'

export interface ProcedureDef {
  key: string
  label: string
  detail: string
  section: SheetSection
  visitKeys: string[]
  order: number
  orderFixed: boolean
  conditions: Condition[]
  whenLabel?: string
  tone?: 'red' | 'amber' | 'violet' | 'green' | 'grey' | 'teal'
  action?: 'manual' | 'consult' | null
  consultDraft?: string
}

export type Certainty = 'high' | 'low'

export interface CellDef {
  visitKey: string
  procedureKey: string
  mark: 'x' | 'conditional'
  page: number
  certainty: Certainty
  noteRefs: string[]
  quote: string
  highlights: string[]
  howRead: string
  sourceLabel: string
}

export interface NoteDef {
  ref: string
  tableKey: string
  text: string
  page: number
  conditions: Condition[]
}

export interface RuleDef {
  id: string
  text: string
  page: number
  conditions: Condition[]
}

export interface InconsistencyDef {
  id: string
  kind: string
  description: string
  pages: number[]
}

export interface PatientConditions {
  dt2: boolean
  erc: boolean
  ic: boolean
  wocbp: boolean
}

export interface ConsentItem {
  label: string
  state: 'vigente' | 'revisar'
  page: number | null
}

export interface PatientDef {
  id: string
  code: string
  /** Días respecto de hoy para la fecha inicial de la visita 2 real. */
  anchorOffsetDays: number
  arm: 'A' | 'B'
  conditions: PatientConditions
  consents: ConsentItem[]
}

export interface ScriptedAnswer {
  id: string
  patterns: string[]
  answer: string
  page: number | null
}

export interface DemoStudy {
  code: 'FIC-002'
  phase: 'Fase 3'
  title: string
  visits: VisitDef[]
  procedures: ProcedureDef[]
  cells: CellDef[]
  notes: NoteDef[]
  rules: RuleDef[]
  inconsistencies: InconsistencyDef[]
  patients: PatientDef[]
  answers: ScriptedAnswer[]
}

export interface PatientState extends PatientConditions {
  arm: 'A' | 'B'
}
