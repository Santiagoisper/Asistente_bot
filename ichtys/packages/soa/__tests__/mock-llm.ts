/**
 * __tests__/mock-llm.ts — el modelo simulado "perfecto" de la orden §4:
 * respuestas DERIVADAS DEL GOLD que mide la tubería (el ensamblado), no el
 * modelo. Implementa LlmPort alineando la tabla de la entrada con la del
 * gold POR PÁGINAS (la misma C2 del calificador): el ensamblado pasa
 * tableKey del raw (T2) y el gold nombra la suya distinto (U2, E1, Q0…).
 *
 * El escenario "ruidoso" (errores inyectados) llega en el commit 5 como
 * mutaciones sobre estas respuestas, en fixtures/mock-llm/*.json.
 */
import type {
  LlmPort,
  HeadersInput,
  HeadersOutput,
  NotesInput,
  NotesOutput,
  RowsInput,
  RowsOutput,
} from '../normalize/llm-steps'
import { parseTiming } from '../normalize/timing'
import { parseWindow } from '../normalize/window'
import type { GoldSchedule } from '../normalize/score'
import type { RawSchedule, RawTable } from '../types'

function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** La tabla del gold con máximo solapamiento de páginas (C2). */
function goldTableFor(rawTable: RawTable, gold: GoldSchedule): GoldSchedule['tables'][number] | null {
  let best: GoldSchedule['tables'][number] | null = null
  let bestOverlap = 0
  for (const gt of gold.tables) {
    const overlap = rawTable.pages.filter((p) => gt.pages.includes(p)).length
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = gt
    }
  }
  return best
}

export interface PerfectLlmDeps {
  raw: RawSchedule
  gold: GoldSchedule
}

/** LlmPort perfecto: por tabla alineada, responde desde el gold. */
export function buildPerfectLlm(deps: PerfectLlmDeps): LlmPort {
  const { raw, gold } = deps

  const rawTableByKey = new Map(raw.tables.map((t) => [t.key, t]))
  const goldTableByRawKey = new Map<string, GoldSchedule['tables'][number]>()
  for (const t of raw.tables) {
    const gt = goldTableFor(t, gold)
    if (gt) goldTableByRawKey.set(t.key, gt)
  }

  return {
    async classifyHeaders(input: HeadersInput): Promise<HeadersOutput> {
      const table = rawTableByKey.get(input.tableKey)
      const gt = goldTableByRawKey.get(input.tableKey)
      const goldVisits = gt ? gold.visits.filter((v) => v.tableKey === gt.key) : []

      return {
        headers: input.headers.map((h, i) => {
          const col = table?.columns.find((c) => c.index === h.col)
          const gv = goldVisits[i] // n-ésima visita ↔ n-ésima columna (verificado 1:1)
          const out: HeadersOutput['headers'][number] = {
            col: h.col,
            type: (gv?.type ?? 'standard') as HeadersOutput['headers'][number]['type'],
            printedIdSpan: null,
            armOnlySpan: null,
          }
          // Span del id impreso DENTRO del headerText real (nunca texto nuevo).
          if (gv?.printedId && col && col.headerText.includes(gv.printedId)) {
            const start = col.headerText.indexOf(gv.printedId)
            out.printedIdSpan = [start, start + gv.printedId.length]
          }
          // timingIfUnparsed: solo donde el parser determinista no llega.
          const parsed = col ? parseTiming(col.headerText) : null
          if (!parsed && gv?.timing.value !== null && gv?.timing.value !== undefined) {
            out.timingIfUnparsed = { value: gv.timing.value, unit: gv.timing.unit as 'day' | 'week' }
          }
          // windowIfUnparsed (K6): texto no vacío que no parsea + gold con ventana.
          const parsedW = parseWindow(h.windowText)
          if (!parsedW && h.windowText.trim().length > 0 && gv?.window) {
            out.windowIfUnparsed = { before: gv.window.before, after: gv.window.after, unit: gv.window.unit as 'day' | 'week' }
          }
          return out
        }),
      }
    },

    async classifyRows(input: RowsInput): Promise<RowsOutput> {
      const table = rawTableByKey.get(input.tableKey)
      const gt = goldTableByRawKey.get(input.tableKey)
      // Labels de procedimientos del gold PRESENTES en esta tabla (vía celdas).
      const goldLabelsHere = new Set<string>()
      for (const c of gold.cells) {
        const v = gold.visits.find((gv) => gv.key === c.visitKey)
        if (!v || v.tableKey !== gt?.key) continue
        const p = gold.procedures.find((gp) => gp.key === c.procedureKey)
        if (p) goldLabelsHere.add(plain(p.label))
      }
      // C4: condiciones de fila del gold, por label («(solo brazo A)»).
      type RowCond = RowsOutput['rows'][number]['conditions'][number]
      const rowConditionsByLabel = new Map<string, RowsOutput['rows'][number]['conditions']>()
      for (const p of gold.procedures) {
        if (!p.conditions?.length) continue
        rowConditionsByLabel.set(
          plain(p.label),
          p.conditions.map((c): RowCond => ({ kind: c.kind as RowCond['kind'], expr: c.expr })),
        )
      }

      return {
        rows: input.rows.map((r) => {
          const label = plain(r.label)
          const rawRow = table?.rows.find((row) => row.index === r.row)
          let kind: RowsOutput['rows'][number]['kind'] = 'narrative_rule'
          if (goldLabelsHere.has(label)) {
            kind = 'procedure'
          } else if (/^(ayuno|fasting)/.test(label)) {
            kind = 'attribute_fasting'
          } else if (/^(visita a la clinica|en el centro|on ?site)/.test(label)) {
            kind = 'attribute_onsite'
          } else if (/^tipo/.test(label) || /^visit type/.test(label)) {
            kind = 'attribute_visit_type'
          } else if (rawRow && !rawRow.isAttributeCandidate && r.hasMarks) {
            // Con marcas y sin clasificación previa: procedimiento (los
            // fixtures no traen secciones; la mecánica vive en el ensamblado).
            kind = 'procedure'
          }
          return { row: r.row, kind, conditions: rowConditionsByLabel.get(label) ?? [] }
        }),
      }
    },

    async parseNotes(input: NotesInput): Promise<NotesOutput> {
      type NoteCond = NotesOutput['notes'][number]['conditions'][number]
      return {
        notes: input.notes.flatMap((n) => {
          // La nota del gold con mismo ref (los refs del generador coinciden
          // raw↔gold); sin gold no hay respuesta «perfecta» posible.
          const gn = (gold.notes ?? []).find((g) => g.ref === n.ref && plain(g.text) === plain(n.text))
          if (!gn) return []
          const conds = (gn.conditions ?? []).map<NoteCond>((c) => {
            const out: NoteCond = {
              kind: c.kind as NoteCond['kind'],
              expr: c.expr,
              appliesTo: n.calledFrom.length > 0 ? ('cells' as const) : ('row' as const),
            }
            // El momento respecto de la dosis es determinista del TEXTO.
            if (c.kind === 'dose_timing') {
              const t = plain(n.text)
              if (/antes de la dosis/.test(t)) return { ...out, doseTiming: 'pre' as const }
              if (/entre \d+ y \d+ horas despues/.test(t)) return { ...out, doseTiming: 'between' as const }
              if (/despues de la dosis/.test(t)) return { ...out, doseTiming: 'post' as const }
            }
            return out
          })
          // Ventana propia: el texto de la nota ES una ventana (parser §0.2).
          const pwMatch = n.text.match(/ventana propia:\s*(.+?)\s*[.!]*\s*$/i)
          const pwText = pwMatch?.[1]
          const pw = pwText !== undefined ? parseWindow(pwText) : null
          if (pw && conds.length > 0) {
            conds[0] = { ...conds[0]!, procedureWindow: { before: pw.before ?? 0, after: pw.after ?? 0, unit: pw.unit === 'week' ? 'week' : 'day' } }
          }
          return [{ ref: n.ref, conditions: conds }]
        }),
      }
    },
    async parseOutOfTableRules(): Promise<never> {
      // Sin fuente: RawSchedule no trae los párrafos de reglas previas a la
      // grilla (hallazgo reportado). Si alguien llama acá, es un bug.
      throw new Error('parseOutOfTableRules: sin fuente — P2 no expone los párrafos de reglas')
    },
  }
}
