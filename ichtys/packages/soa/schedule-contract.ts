/**
 * schedule-contract.ts — contrato de `spec.schedule` EXACTO a ADR-10 §3,
 * en zod 4.6.7 con cota en todo (ADR-8 M5: ≤ 10 opcionales — aquí 0, porque
 * el contrato no usa `.optional()`: lo ausente va como `null`, que sigue en
 * `required` y no cuenta para el límite de `supportsNativeStructuredOutputSchema`).
 *
 * Cotas medidas sobre F1–F5 + margen: días −42…800 y semanas 2…144 →
 * value ∈ [−60, 900]; ventanas before ≤ 14 y after ≤ 42 → [0,30] / [0,60].
 * El texto de `notes.text`, `label` y `description` es del protocolo del
 * cliente: viaja en la salida, se valida aquí y NUNCA se loguea (S8).
 */
import { z } from 'zod'

// — primitivas con cota —
const Page = z.number().int().min(1).max(999)
const Confidence = z.number().min(0).max(1)
const Bbox = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
])

export const conditionKindSchema = z.enum([
  'population',
  'arm',
  'dose_timing',
  'consent',
  'country',
  'event',
  'dependency',
  'order',
  'fasting',
])
export type ConditionKind = z.infer<typeof conditionKindSchema>

export const conditionSchema = z.object({
  kind: conditionKindSchema,
  expr: z.string().max(300),
  sourceRef: z.string().max(16),
  page: Page,
  confidence: Confidence,
})
export type Condition = z.infer<typeof conditionSchema>

export const unitSchema = z.enum(['day', 'week'])

export const timingSchema = z.object({
  kind: z.enum(['scheduled', 'event', 'recurrent']),
  value: z.number().int().min(-60).max(900).nullable(),
  unit: unitSchema.nullable(),
  anchor: z.string().max(32).nullable(),
  recurrence: z
    .object({
      every: z.number().int().min(1).max(52),
      unit: z.literal('week'),
      until: z.string().max(12).nullable(),
    })
    .nullable(),
})
export type Timing = z.infer<typeof timingSchema>

export const windowSchema = z.object({
  before: z.number().int().min(0).max(30).nullable(),
  after: z.number().int().min(0).max(60).nullable(),
  unit: unitSchema.nullable(),
})
export type VisitWindow = z.infer<typeof windowSchema>

export const procedureWindowSchema = z.object({
  before: z.number().int().min(0).max(30),
  after: z.number().int().min(0).max(60),
  unit: z.enum(['day', 'week', 'hour']),
})
export type ProcedureWindow = z.infer<typeof procedureWindowSchema>

export const visitTypeSchema = z.enum([
  'standard',
  'pk_only',
  'dispense_only',
  'hybrid',
  'remote',
  'screening',
  'end_of_study',
  'early_termination',
  'unscheduled',
  'follow_up',
])
export type VisitType = z.infer<typeof visitTypeSchema>

export const visitSchema = z.object({
  key: z.string().max(32),
  tableKey: z.string().max(32),
  printedId: z.string().max(16).nullable(),
  label: z.string().max(120),
  timing: timingSchema,
  window: windowSchema.nullable(),
  type: visitTypeSchema,
  attributes: z.object({
    fasting: z.boolean().nullable(),
    onSite: z.boolean().nullable(),
    armOnly: z.string().max(64).nullable(),
  }),
  source: z.object({ page: Page, bbox: Bbox }),
  confidence: Confidence,
})
export type Visit = z.infer<typeof visitSchema>

export const tableSchema = z.object({
  key: z.string().max(32),
  title: z.string().max(200),
  branch: z.string().max(64).nullable(),
  phase: z.string().max(32).nullable(),
  pages: z.array(Page).min(1).max(40),
  outcome: z.enum(['complete', 'partial', 'failed']),
  reasons: z.array(z.string().max(64)).max(16),
})
export type ScheduleTable = z.infer<typeof tableSchema>

export const procedureSchema = z.object({
  key: z.string().max(32),
  label: z.string().max(200),
  section: z.string().max(64).nullable(),
  kind: z.enum(['procedure', 'narrative_rule']),
  conditions: z.array(conditionSchema).max(16),
  source: z.object({ page: Page, bbox: Bbox }),
})
export type Procedure = z.infer<typeof procedureSchema>

export const cellSchema = z.object({
  visitKey: z.string().max(32),
  procedureKey: z.string().max(32),
  mark: z.enum(['x', 'prn_range', 'conditional']),
  noteRefs: z.array(z.string().max(16)).max(8),
  conditions: z.array(conditionSchema).max(16),
  procedureWindow: procedureWindowSchema.nullable(),
  source: z.object({ page: Page, bbox: Bbox }),
  confidence: Confidence,
  reviewed: z.boolean(),
})
export type Cell = z.infer<typeof cellSchema>

export const noteSchema = z.object({
  ref: z.string().max(16),
  tableKey: z.string().max(32),
  text: z.string().max(1000),
  page: Page,
  conditions: z.array(conditionSchema).max(16),
})
export type Note = z.infer<typeof noteSchema>

export const outOfTableRuleSchema = z.object({
  text: z.string().max(1000),
  page: Page,
  conditions: z.array(conditionSchema).max(16),
})
export type OutOfTableRule = z.infer<typeof outOfTableRuleSchema>

export const inconsistencySchema = z.object({
  kind: z.string().max(48),
  description: z.string().max(500),
  pages: z.array(Page).min(1).max(40),
  status: z.enum(['open', 'seen', 'asked_sponsor']),
})
export type Inconsistency = z.infer<typeof inconsistencySchema>

export const scheduleSchema = z.object({
  tables: z.array(tableSchema).max(8),
  visits: z.array(visitSchema).max(200),
  procedures: z.array(procedureSchema).max(500),
  cells: z.array(cellSchema).max(6000),
  notes: z.array(noteSchema).max(200),
  outOfTableRules: z.array(outOfTableRuleSchema).max(50),
  inconsistencies: z.array(inconsistencySchema).max(50),
})
export type Schedule = z.infer<typeof scheduleSchema>
