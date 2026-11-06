/**
 * Commit 5 — escenario ruidoso (orden B-P3 §4): el modelo simulado se
 * equivoca (span fuera del header, tipo mal, fila y ref inexistentes) y el
 * DOCUMENTO trae una nota con inyección de instrucciones. El ensamblado es
 * fail-closed: lo inválido no entra al Schedule, todo descarte queda
 * advertido con código (T15), y la inyección no produce interpretación
 * (T10). Las cifras salen del calificador oficial (K8).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadPageGeometry, locateSchedule, readGrid } from '../index'
import { normalizeSchedule } from '../normalize/assemble'
import { scheduleSchema } from '../schedule-contract'
import type { ScoreReport, ScheduleDoc } from './official-score-shapes'
import type { RawSchedule } from '../types'
import { buildNoisyLlm, type NoisyMutations } from './noisy-llm'
import { buildPerfectLlm } from './mock-llm'

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa/', import.meta.url))
const MOCKS_DIR = fileURLToPath(new URL('./fixtures/mock-llm/', import.meta.url))

const officialScoreUrl: string = '../../../scripts/soa-fixtures/score'
const { scoreSchedule } = (await import(officialScoreUrl)) as {
  scoreSchedule: (gold: ScheduleDoc, candidate: ScheduleDoc) => ScoreReport
}

interface NoisyRun {
  raw: RawSchedule
  gold: ScheduleDoc
  schedule: Awaited<ReturnType<typeof normalizeSchedule>>['schedule']
  warnings: string[]
  mutations: NoisyMutations
}

async function loadNoisy(): Promise<NoisyRun> {
  const pdf = new Uint8Array(readFileSync(`${FIXTURES_DIR}F1.pdf`))
  const pages = await loadPageGeometry(pdf)
  const rawBase = readGrid(pages, locateSchedule(pages))
  const gold = JSON.parse(readFileSync(`${FIXTURES_DIR}F1.gold.json`, 'utf8')) as ScheduleDoc
  const { mutations } = JSON.parse(readFileSync(`${MOCKS_DIR}F1.ruidoso.json`, 'utf8')) as {
    mutations: NoisyMutations
  }

  // La inyección vive en el DOCUMENTO: el test la agrega al raw, no al
  // modelo. Geometría prestada de una nota real de la misma tabla.
  const raw = structuredClone(rawBase)
  const table = raw.tables.find((t) => t.notes.length > 0)!
  const anchor = table.notes[0]!
  table.notes.push({
    ref: mutations.notaInyectada!.ref,
    page: anchor.page,
    text: mutations.notaInyectada!.text,
    bbox: [...anchor.bbox] as typeof anchor.bbox,
  })

  const result = await normalizeSchedule(raw, { llm: buildNoisyLlm({ raw, gold }, mutations) })
  return { raw, gold, schedule: result.schedule, warnings: result.warnings, mutations }
}

describe('commit 5 — escenario ruidoso: defensas del ensamblado', () => {
  it('T3: el span fuera del header no inventa — el determinista manda (R3)', async () => {
    const run = await loadNoisy()
    const s = scoreSchedule(run.gold, run.schedule)
    expect(s.visits.tp).toBe((run.gold.visits ?? []).length)
    expect(s.visits.fp).toBe(0)
    expect(s.visits.fn).toBe(0)
    expect(s.printedIds.exact).toBe((run.gold.visits ?? []).length)
    expect(s.printedIds.invented).toBe(0)
    // El spanFuera es INERTE en F1 por diseño: el id impreso se resuelve
    // determinista primero y el span del modelo solo es fallback (R3) — el
    // determinista cubre las 46 columnas, así que el error ni se consulta.
    // La defensa del span (validación + :span_invalido_descartado cuando el
    // fallback se usa) tiene cobertura unitaria en normalize-assemble.
  })

  it('T4: el tipo mal cuesta UN par (fp=fn=1) y nada más; ventanas intactas', async () => {
    const run = await loadNoisy()
    const s = scoreSchedule(run.gold, run.schedule)
    expect(s.types.fp).toBe(1)
    expect(s.types.fn).toBe(1)
    expect(s.windows.fp).toBe(0)
    expect(s.windows.fn).toBe(0)
  })

  it('T6: la fila inexistente no genera procedimiento ni celda — cells 100 %', async () => {
    const run = await loadNoisy()
    const s = scoreSchedule(run.gold, run.schedule)
    expect(s.cells.fp).toBe(0)
    expect(s.cells.fn).toBe(0)
    expect(run.warnings.some((w) => w.endsWith(':fila_inexistente'))).toBe(true)
    expect(run.schedule.procedures.every((p) => !p.key.endsWith('R999'))).toBe(true)
  })

  it('T8: la ref inexistente se descarta; los vínculos de nota siguen 100 %', async () => {
    const run = await loadNoisy()
    const s = scoreSchedule(run.gold, run.schedule)
    expect(s.notes.fp).toBe(0)
    expect(s.notes.fn).toBe(0)
    expect(s.notes.tp).toBe(25)
    expect(run.warnings.some((w) => w.endsWith(':ref_inexistente'))).toBe(true)
    expect(run.schedule.notes.every((n) => n.ref !== 'ZZ')).toBe(true)
  })

  it('T10: la nota inyectada viaja SIN interpretación, con advertencia', async () => {
    const run = await loadNoisy()
    const inyectada = run.schedule.notes.find(
      (n) => n.text === run.mutations.notaInyectada!.text,
    )
    expect(inyectada).toBeDefined()
    expect(inyectada!.conditions).toHaveLength(0)
    // Su ref '3' DUPLICA el de una nota real de T1: el caso duro. La
    // ambigüedad se declara — y sin el fail-closed la respuesta de la nota
    // legítima quedaba pegada al texto de la inyección (hallazgo T10).
    expect(run.warnings.some((w) => w.endsWith(':ref_duplicado'))).toBe(true)
    // Ninguna celda del Schedule quedó condicionada por la inyección.
    const conAyuno = run.schedule.cells.filter((c) =>
      c.conditions.some((k) => k.expr.toLowerCase().includes('ayunas')),
    )
    expect(conAyuno).toHaveLength(0)
  })

  it('T10: fuera de esa nota, CERO cambios respecto del modelo perfecto', async () => {
    const run = await loadNoisy()
    // Corrida limpia: mismo raw SIN la nota inyectada, modelo perfecto.
    const pdf = new Uint8Array(readFileSync(`${FIXTURES_DIR}F1.pdf`))
    const pages = await loadPageGeometry(pdf)
    const rawLimpio = readGrid(pages, locateSchedule(pages))
    const clean = await normalizeSchedule(rawLimpio, {
      llm: buildPerfectLlm({ raw: rawLimpio, gold: run.gold }),
    })

    // Visitas: idénticas salvo el type de la columna del tipoMal.
    const colTipoMal = run.mutations.tipoMal!.col
    const keys = (v: typeof clean.schedule.visits[number]) => v.key
    expect(run.schedule.visits.map(keys)).toEqual(clean.schedule.visits.map(keys))
    let typesDistintos = 0
    run.schedule.visits.forEach((v, i) => {
      const otro = clean.schedule.visits[i]!
      if (v.type !== otro.type) typesDistintos += 1
      expect(v.timing, v.key).toEqual(otro.timing)
      expect(v.printedId, v.key).toBe(otro.printedId)
      expect(v.window, v.key).toEqual(otro.window)
    })
    // Solo la visita de la columna envenenada cambió de tipo.
    expect(typesDistintos).toBe(1)
    expect(run.schedule.visits.some((v) => v.type === 'screening')).toBe(true)
    expect(run.raw.tables.some((t) => t.columns.some((c) => c.index === colTipoMal))).toBe(true)

    // Celdas y procedimientos: byte a byte.
    expect(run.schedule.cells).toEqual(clean.schedule.cells)
    expect(run.schedule.procedures).toEqual(clean.schedule.procedures)

    // Notas: idénticas salvo el ref duplicado. La inyectada es la ÚNICA
    // nueva (estéril); la nota real del ref duplicado pierde su
    // interpretación — el costo documentado del fail-closed ante la
    // ambigüedad que la inyección introduce (sin él, la respuesta de la
    // legítima quedaba pegada al texto de la inyección).
    expect(run.schedule.notes).toHaveLength(clean.schedule.notes.length + 1)
    const cleanByRef = new Map(clean.schedule.notes.map((n) => [`${n.tableKey}|${n.ref}`, n]))
    let inyectadas = 0
    let esterilizadas = 0
    for (const n of run.schedule.notes) {
      // (tableKey|ref) no distingue a la inyectada de la real que duplica:
      // el TEXTO sí (la inyección no puede copiar el texto de la legítima).
      if (n.text === run.mutations.notaInyectada!.text) {
        inyectadas += 1
        expect(n.conditions).toHaveLength(0)
        continue
      }
      const otra = cleanByRef.get(`${n.tableKey}|${n.ref}`)
      expect(otra, `${n.tableKey}|${n.ref}`).toBeDefined()
      if (n.conditions.length !== otra!.conditions.length) {
        expect(n.ref).toBe(run.mutations.notaInyectada!.ref)
        expect(n.conditions).toHaveLength(0)
        esterilizadas += 1
      }
    }
    expect(inyectadas).toBe(1)
    expect(esterilizadas).toBe(1)
  })

  it('T15: todos los warnings del escenario siguen siendo solo códigos', async () => {
    const run = await loadNoisy()
    for (const w of run.warnings) {
      expect(w).toMatch(/^T\d+(:[CRN]\d+)*:[a-z_]+$/)
    }
    // El Schedule ruidoso sigue validando contra el contrato.
    expect(scheduleSchema.safeParse(run.schedule).success).toBe(true)
  })
})
