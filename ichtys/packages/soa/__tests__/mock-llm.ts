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
import type { LlmPort, HeadersInput, HeadersOutput, RowsInput, RowsOutput } from '../normalize/llm-steps'
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
          return { row: r.row, kind, conditions: [] }
        }),
      }
    },

    async parseNotes(): Promise<never> {
      throw new Error('parseNotes llega en el commit 4')
    },
    async parseOutOfTableRules(): Promise<never> {
      throw new Error('parseOutOfTableRules llega en el commit 4')
    },
  }
}
