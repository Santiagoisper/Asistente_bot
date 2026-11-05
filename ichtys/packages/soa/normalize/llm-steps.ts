/**
 * normalize/llm-steps.ts — puerto y esquemas de las 4 llamadas del
 * normalizador (P3, orden B-P3 §2). Regla de oro: el modelo SOLO devuelve
 * índices, spans y enums — nunca la matriz ni texto nuevo. El texto del
 * documento viaja delimitado como DATO en las entradas y su referencia de
 * vuelta es un span `[start, end)` sobre ese mismo texto o un índice.
 *
 * El puerto es inyectable (`deps.llm`): los tests usan el modelo simulado;
 * en producción lo implementa @ichtys/llm con `generateText` + output
 * estructurado (ai@7) vía `runWithLlmFallback({ purpose: 'spec' })`, una
 * llamada por tabla en paralelo y cada una < 30 s (ADR-10 §2.2-f).
 *
 * Cotas (ADR-8): `.max` en todo; ≤ 10 opcionales por esquema (M5) — estos
 * usan 2 como máximo. Nada de esto se loguea con contenido (S8).
 */
import { z } from 'zod'
import { conditionKindSchema, unitSchema, visitTypeSchema } from '../schedule-contract'

// ── Entradas (validación + límites de tamaño por llamada) ────────────────

export const headerInputSchema = z.object({
  col: z.number().int().min(0).max(199),
  headerText: z.string().max(120),
  timeText: z.string().max(24),
  windowText: z.string().max(48),
})

export const rowInputSchema = z.object({
  row: z.number().int().min(0).max(499),
  label: z.string().max(200),
  hasMarks: z.boolean(),
  commentText: z.string().max(300),
})

export const noteInputSchema = z.object({
  ref: z.string().max(16),
  text: z.string().max(1000),
  calledFrom: z
    .array(
      z.object({
        row: z.number().int().min(0).max(499),
        col: z.number().int().min(0).max(199).optional(),
      }),
    )
    .max(32),
})

export const ruleParagraphSchema = z.object({
  index: z.number().int().min(0).max(199),
  text: z.string().max(1000),
})

export interface HeadersInput {
  tableTitle: string
  headers: Array<{ col: number; headerText: string; timeText: string; windowText: string }>
}
export interface RowsInput {
  rows: Array<{ row: number; label: string; hasMarks: boolean; commentText: string }>
}
export interface NotesInput {
  notes: Array<{ ref: string; text: string; calledFrom: Array<{ row: number; col?: number }> }>
}
export interface RulesInput {
  paragraphs: Array<{ index: number; text: string }>
}

// ── Salidas (viajan al proveedor como output schema — M4/M5) ────────────

const spanSchema = z
  .tuple([z.number().int().min(0).max(119), z.number().int().min(1).max(120)])
  .refine(([start, end]) => start < end, { message: 'span vacío' })

export const headersOutputSchema = z.object({
  headers: z
    .array(
      z.object({
        col: z.number().int().min(0).max(199),
        /** Span [start, end) sobre `headerText` de la entrada: el id
         *  impreso recortado del texto real, nunca texto nuevo. */
        printedIdSpan: spanSchema.nullable(),
        type: visitTypeSchema,
        timingIfUnparsed: z
          .object({ value: z.number().int().min(-60).max(900), unit: unitSchema })
          .optional(),
        armOnly: z.string().max(64).optional(),
      }),
    )
    .max(200),
})
export type HeadersOutput = z.infer<typeof headersOutputSchema>

const exprConditionSchema = z.object({
  kind: conditionKindSchema,
  expr: z.string().max(300),
})

export const rowsOutputSchema = z.object({
  rows: z
    .array(
      z.object({
        row: z.number().int().min(0).max(499),
        kind: z.enum([
          'procedure',
          'attribute_fasting',
          'attribute_onsite',
          'attribute_visit_type',
          'section',
          'narrative_rule',
        ]),
        conditions: z.array(exprConditionSchema).max(16),
      }),
    )
    .max(500),
})
export type RowsOutput = z.infer<typeof rowsOutputSchema>

export const notesOutputSchema = z.object({
  notes: z
    .array(
      z.object({
        ref: z.string().max(16),
        conditions: z
          .array(
            z.object({
              kind: conditionKindSchema,
              expr: z.string().max(300),
              appliesTo: z.enum(['row', 'cells']),
              doseTiming: z.string().max(120).optional(),
              procedureWindow: z
                .object({
                  before: z.number().int().min(0).max(30),
                  after: z.number().int().min(0).max(60),
                  unit: z.enum(['day', 'week', 'hour']),
                })
                .optional(),
            }),
          )
          .max(16),
      }),
    )
    .max(200),
})
export type NotesOutput = z.infer<typeof notesOutputSchema>

export const rulesOutputSchema = z.object({
  rules: z
    .array(
      z.object({
        /** Índice del párrafo en la ENTRADA (nunca texto nuevo). */
        paragraph: z.number().int().min(0).max(199),
        conditions: z.array(exprConditionSchema).max(16),
        affectsVisits: z.union([z.array(z.number().int().min(0).max(199)).max(200), z.literal('all')]),
      }),
    )
    .max(50),
})
export type RulesOutput = z.infer<typeof rulesOutputSchema>

// ── Puerto inyectable ────────────────────────────────────────────────────

export interface LlmPort {
  classifyHeaders(input: HeadersInput): Promise<HeadersOutput>
  classifyRows(input: RowsInput): Promise<RowsOutput>
  parseNotes(input: NotesInput): Promise<NotesOutput>
  parseOutOfTableRules(input: RulesInput): Promise<RulesOutput>
}
