/**
 * __tests__/noisy-llm.ts — el modelo "ruidoso" de la orden §4: el perfecto
 * con los errores inyectados que declara fixtures/mock-llm/F1.ruidoso.json.
 *
 * El ensamblado tiene que ser fail-closed ante un modelo que se equivoca:
 * nada de lo inválido entra al Schedule y todo descarte queda advertido con
 * código. La notaInyectada NO es una mutación del modelo: la aplica el test
 * al RAW (la inyección vive en el DOCUMENTO, T10) — este archivo no la toca.
 *
 * Cada mutación declara su `table`: classifyHeaders/classifyRows se llaman
 * por tabla, y una mutación por `col`/`row` sin tabla envenenaría TODAS
 * (medido: col 1 existe en las 3 tablas de F1 → 3 types mal en vez de 1).
 */
import type { LlmPort } from '../normalize/llm-steps'
import { buildPerfectLlm, type PerfectLlmDeps } from './mock-llm'

export interface NoisyMutations {
  /** printedIdSpan que se sale del headerText (tabla + col + [start, end]). */
  spanFuera?: { table: string; col: number; span: [number, number] }
  /** Tipo de visita mal clasificado para una columna. */
  tipoMal?: { table: string; col: number; type: string }
  /** classifyRows responde una fila que no está en la tabla. */
  filaInexistente?: { table: string; row: number }
  /**
   * parseNotes responde un ref que no existe en el documento. NotesInput no
   * lleva tableKey, así que se acota a la tabla que contiene la
   * notaInyectada (el par viaja junto en el escenario §4).
   */
  notaRefInexistente?: string
  /** Nota de inyección agregada al DOCUMENTO por el test (T10). */
  notaInyectada?: { ref: string; text: string }
}

/** El LlmPort perfecto con las mutaciones de arriba aplicadas encima. */
export function buildNoisyLlm(deps: PerfectLlmDeps, mutations: NoisyMutations): LlmPort {
  const perfect = buildPerfectLlm(deps)
  return {
    async classifyHeaders(input) {
      const out = await perfect.classifyHeaders(input)
      if (mutations.spanFuera && input.tableKey === mutations.spanFuera.table) {
        for (const h of out.headers) {
          if (h.col === mutations.spanFuera.col) {
            h.printedIdSpan = [mutations.spanFuera.span[0], mutations.spanFuera.span[1]]
          }
        }
      }
      if (mutations.tipoMal && input.tableKey === mutations.tipoMal.table) {
        for (const h of out.headers) {
          if (h.col === mutations.tipoMal.col) {
            h.type = mutations.tipoMal.type as typeof h.type
          }
        }
      }
      return out
    },

    async classifyRows(input) {
      const out = await perfect.classifyRows(input)
      if (mutations.filaInexistente && input.tableKey === mutations.filaInexistente.table) {
        out.rows.push({
          row: mutations.filaInexistente.row,
          kind: 'procedure',
          conditions: [],
        })
      }
      return out
    },

    async parseNotes(input) {
      const out = await perfect.parseNotes(input)
      const enTablaInyectada =
        mutations.notaRefInexistente !== undefined &&
        input.notes.some((n) => n.text === mutations.notaInyectada?.text)
      if (enTablaInyectada) {
        out.notes.push({ ref: mutations.notaRefInexistente!, conditions: [] })
      }
      return out
    },

    parseOutOfTableRules: perfect.parseOutOfTableRules,
  }
}
