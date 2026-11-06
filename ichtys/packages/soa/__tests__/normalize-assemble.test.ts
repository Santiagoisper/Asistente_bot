/**
 * Commit 3 — el ensamblado RawSchedule → Schedule con el modelo simulado
 * «perfecto» (orden B-P3 §4): las métricas miden la TUBERÍA, no el modelo.
 *
 * T3 visitas P=R=100%, 0 ids inventados, 3 «sin número» en F3 · T4 tipos
 * 100 % · T5 filas de atributo fuera de cells · T6 celdas P≥98 % R≥97 % ·
 * T7 prn 80/80 en F2 · T12 outcome partial propagado con motivo.
 *
 * El «rojo» de esta orden: `normalizeSchedule` no existía — nada de esto
 * corría. Los atributos de visita (fasting/onSite) NO se miden aquí: P2
 * descarta las marcas de filas de atributo (grid.ts marksAttr) y esa es la
 * causa documentada, no una pérdida del ensamblado.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadPageGeometry, locateSchedule, readGrid } from '../index'
import { normalizeSchedule } from '../normalize/assemble'
import { scheduleSchema } from '../schedule-contract'
import { scoreSchedule, type GoldSchedule, type ScoreScheduleResult } from '../normalize/score'
import type { RawSchedule } from '../types'
import { buildPerfectLlm } from './mock-llm'

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa/', import.meta.url))
const FIXTURES = ['F1', 'F2', 'F3', 'F4', 'F5'] as const

interface Loaded {
  raw: RawSchedule
  gold: GoldSchedule
  schedule: ReturnType<typeof JSON.parse>
  warnings: string[]
  calls: number
}

const cache = new Map<string, Loaded>()

async function load(fixture: string): Promise<Loaded> {
  const hit = cache.get(fixture)
  if (hit) return hit
  const pdf = new Uint8Array(readFileSync(`${FIXTURES_DIR}${fixture}.pdf`))
  const pages = await loadPageGeometry(pdf)
  const raw = readGrid(pages, locateSchedule(pages))
  const gold = JSON.parse(readFileSync(`${FIXTURES_DIR}${fixture}.gold.json`, 'utf8'))
  const result = await normalizeSchedule(raw, { llm: buildPerfectLlm({ raw, gold }) })
  const entry: Loaded = {
    raw,
    gold,
    schedule: result.schedule,
    warnings: result.warnings,
    calls: result.usage.calls,
  }
  cache.set(fixture, entry)
  return entry
}

function scoreOf(entry: Loaded): ScoreScheduleResult {
  return scoreSchedule(entry.gold, entry.schedule, entry.raw)
}

describe('commit 3 — T3: visitas (scoreSchedule con C1–C3)', () => {
  it('P = R = 100 % y 0 ids inventados en F1–F5', async () => {
    for (const fx of FIXTURES) {
      const s = scoreOf(await load(fx))
      expect(s.visits.matched, `${fx} matched`).toBe(s.visits.goldTotal)
      expect(s.visits.goldTotal, `${fx} goldTotal`).toBe(s.visits.outTotal)
      expect(s.ids.invented, `${fx} invented`).toBe(0)
      expect(s.ids.exact, `${fx} exact`).toBe(s.visits.goldTotal)
    }
  })

  it('F3: exactamente 3 «sin número» y el ensamblado las deja en null', async () => {
    const f3 = await load('F3')
    const s = scoreOf(f3)
    expect(s.ids.sinNumeroGold).toBe(3)
    expect(s.ids.sinNumeroOutOk).toBe(3)
    // Las 3 son las columnas «—» de la tabla partida, con warning con código.
    const sinNumero = f3.warnings.filter((w) => w.endsWith(':sin_numero'))
    expect(sinNumero).toHaveLength(3)
    // Los «—» nunca llegan a printedId: el id NULL no es texto recortado.
    expect(f3.schedule.visits.filter((v: { printedId: string | null }) => v.printedId === '—')).toHaveLength(0)
  })

  it('el Schedule completo valida contra el contrato (fail-closed del ensamblado)', async () => {
    for (const fx of FIXTURES) {
      const { schedule } = await load(fx)
      expect(scheduleSchema.safeParse(schedule).success, fx).toBe(true)
    }
  })
})

describe('commit 3 — T4: tipos de visita', () => {
  it('100 % de tipos correctos con el modelo perfecto', async () => {
    for (const fx of FIXTURES) {
      const s = scoreOf(await load(fx))
      expect(s.types.correct, `${fx} types`).toBe(s.types.total)
      expect(s.types.total, `${fx} total`).toBeGreaterThan(0)
    }
  })

  it('el timing de F5 sale del parser determinista (D1/W2), sin modelo', async () => {
    const f5 = await load('F5')
    const d1 = f5.schedule.visits.find((v: { printedId: string | null }) => v.printedId === 'D1')
    const w4 = f5.schedule.visits.find((v: { printedId: string | null }) => v.printedId === 'W4')
    expect(d1?.timing).toMatchObject({ kind: 'scheduled', value: 1, unit: 'day' })
    expect(w4?.timing).toMatchObject({ kind: 'scheduled', value: 4, unit: 'week' })
  })

  it('ventanas exactas: ±, hasta/up to, asimétricas y «0 d» sin modelo', async () => {
    for (const fx of FIXTURES) {
      const s = scoreOf(await load(fx))
      expect(s.windows.exact, `${fx} windows`).toBe(s.windows.total)
    }
    // «0 d» de F2 T1: ventana exacta del día justo.
    const f2 = await load('F2')
    const v600 = f2.schedule.visits.find((v: { printedId: string | null }) => v.printedId === 'V600')
    expect(v600?.window).toEqual({ before: 3, after: 3, unit: 'day' })
    const v1t1 = f2.schedule.visits.find((v: { tableKey: string; printedId: string | null }) => v.tableKey === 'T1' && v.printedId === 'V1')
    expect(v1t1?.window).toEqual({ before: 0, after: 0, unit: 'day' })
    // «18–28 d» de F3 T2: rango no parseable → ventana del modelo marcada.
    const f3 = await load('F3')
    expect(f3.warnings.filter((w) => w.endsWith(':ventana_a_revisar')).length).toBeGreaterThan(0)
  })
})

describe('commit 3 — T5: atributos fuera de las celdas', () => {
  it('las filas Ayuno/clínica/Tipo no generan procedimiento ni celda', async () => {
    for (const fx of ['F2', 'F3'] as const) {
      const { schedule } = await load(fx)
      const attrLabels = schedule.procedures.filter((p: { label: string }) =>
        /^(ayuno|visita a la cl[ií]nica|tipo)/i.test(p.label.trim()),
      )
      expect(attrLabels, `${fx} procedures de atributo`).toHaveLength(0)
    }
    for (const fx of FIXTURES) {
      const s = scoreOf(await load(fx))
      expect(s.attributeCellsInCells, `${fx}`).toBe(0)
    }
  })
})

describe('commit 3 — T6: celdas normalizadas (marca x)', () => {
  it('P ≥ 98 % y R ≥ 97 % en F1–F5', async () => {
    for (const fx of FIXTURES) {
      const s = scoreOf(await load(fx))
      expect(s.cellsX.recall, `${fx} recall`).toBeGreaterThanOrEqual(0.97)
      expect(s.cellsX.precision, `${fx} precision`).toBeGreaterThanOrEqual(0.98)
    }
  })
})

describe('commit 3 — T7: prn_range de F2', () => {
  it('80/80 del gold cubiertas por la expansión de la corrida', async () => {
    const s = scoreOf(await load('F2'))
    expect(s.prn.total).toBe(80)
    expect(s.prn.covered).toBe(80)
    // La corrida expandida queda marcada: nada desaparece en silencio.
    const f2 = await load('F2')
    expect(f2.schedule.cells.filter((c: { mark: string }) => c.mark === 'prn_range').length).toBeGreaterThanOrEqual(80)
  })
})

describe('commit 3 — T12: outcome de P2 propagado', () => {
  it('la tabla partial del raw llega partial (nunca complete) con motivo', async () => {
    const f2 = await load('F2')
    const s = scoreOf(f2)
    const partial = s.nonCompleteTables.find((t) => t.outcome === 'partial')
    expect(partial).toBeDefined()
    expect(partial?.reasons.length ?? 0).toBeGreaterThan(0)
    // El resto de las tablas de F2 y todos los outcomes de F1/F3/F4/F5
    // viajan tal cual los reportó P2.
    expect(s.nonCompleteTables).toHaveLength(f2.raw.tables.filter((t) => t.outcome !== 'complete').length)
    for (const fx of ['F1', 'F3', 'F4', 'F5'] as const) {
      const rawNonComplete = (await load(fx)).raw.tables.filter((t) => t.outcome !== 'complete').length
      expect(scoreOf(await load(fx)).nonCompleteTables).toHaveLength(rawNonComplete)
    }
  })
})

describe('commit 4 — T8: notas vinculadas y condiciones', () => {
  it('notas emparejadas ≥ 95 % sobre las que el documento imprime (F1–F5)', async () => {
    for (const fx of FIXTURES) {
      const s = scoreOf(await load(fx))
      expect(s.notes.matched / Math.max(s.notes.reachable, 1), `${fx} notas`).toBeGreaterThanOrEqual(0.95)
      expect(s.notes.outTotal, `${fx} outTotal`).toBe(s.notes.reachable)
    }
    // Hallazgo del generador (reportado): F2 declara 16 notas en el gold
    // que nunca imprime en el PDF — el techo del fixture es 10/26.
    const f2 = scoreOf(await load('F2'))
    expect(f2.notes.reachable).toBe(10)
    expect(f2.notes.goldTotal).toBe(26)
  })

  it('condiciones por tipo ≥ 90 % exactas (notas + fila C4)', async () => {
    for (const fx of FIXTURES) {
      const s = scoreOf(await load(fx))
      const kinds = Object.entries(s.conditionsByKind)
      expect(kinds.length, `${fx} con condiciones`).toBeGreaterThan(0)
      for (const [kind, m] of kinds) {
        expect(m.exact, `${fx} ${kind} exact=${m.exact} gold=${m.gold}`).toBeGreaterThanOrEqual(Math.ceil(m.gold * 0.9))
      }
    }
  })

  it('C4: las conditions de fila del gold llegan a sus procedures', async () => {
    // F3 trae 4 (solo subgrupo X / solo brazo A / solo brazo B).
    const f3 = await load('F3')
    const conProcedimiento = f3.schedule.procedures.filter(
      (p: { conditions: unknown[]; label: string }) => p.conditions.length > 0 && /solo (subgrupo|brazo)/i.test(p.label),
    )
    expect(conProcedimiento.length).toBeGreaterThanOrEqual(4)
    for (const p of conProcedimiento) {
      for (const c of p.conditions) {
        expect(c.kind === 'population' || c.kind === 'arm', JSON.stringify(c)).toBe(true)
      }
    }
  })
})

describe('commit 4 — T9: ventana propia y momento de la dosis', () => {
  it('F3: la ventana propia −4/+2 semanas llega a la celda citante del superíndice', async () => {
    // El gold la planta en E55/C08, pero el PDF cita la nota «Ventana
    // propia» desde OTRA celda (medido: R2/C0, Consentimiento tira 1) — se
    // mide PRESENCIA con el valor exacto, no la celda.
    const f3 = await load('F3')
    const s = scoreOf(f3)
    expect(s.procedureWindows.expected).toBe(1)
    expect(s.procedureWindows.present).toBe(1)
    const conPw = f3.schedule.cells.filter((c: { procedureWindow: unknown }) => c.procedureWindow !== null)
    expect(conPw.length).toBeGreaterThanOrEqual(1)
    expect(conPw[0]!.procedureWindow).toEqual({ before: 4, after: 2, unit: 'week' })
  })

  it('el momento respecto de la dosis queda como condition dose_timing (Antes/Entre 1 y 2 h)', async () => {
    const f3 = await load('F3')
    const s = scoreOf(f3)
    // El gold trae 7 conditions dose_timing en notas (Antes/Entre 1 y 2 h).
    expect(s.conditionsByKind['dose_timing']?.gold).toBe(7)
    expect(s.conditionsByKind['dose_timing']?.exact).toBeGreaterThanOrEqual(Math.ceil(7 * 0.9))
    // Y la celda citante de «Entre 1 y 2 horas…» lleva su condition.
    const condt = f3.schedule.cells.filter((c: { conditions: Array<{ kind: string }> }) =>
      c.conditions.some((cd) => cd.kind === 'dose_timing'),
    )
    expect(condt.length).toBeGreaterThan(0)
  })
})

describe('commit 4 — T11: inconsistencias deterministas (alcance medido)', () => {
  it('F3 detecta duplicated_row y prose_vs_table_limit impresa en la nota', async () => {
    const f3 = await load('F3')
    const kinds = new Set(f3.schedule.inconsistencies.map((i: { kind: string }) => i.kind))
    expect(kinds.has('duplicated_row')).toBe(true)
    expect(kinds.has('prose_vs_table_limit')).toBe(true)
    // La descripción viaja con códigos, sin texto del documento.
    for (const i of f3.schedule.inconsistencies) {
      expect(i.description).toMatch(/^T\d+:(R\d+\/R\d+|N\d+):[a-z_]+$/)
    }
  })

  it('cero inconsistencias inventadas: F1/F2/F4/F5 sin detectores disparados', async () => {
    // El techo medido (reportado al Foreman): followup/hybrid/onsite no son
    // detectables desde el raw actual (prosa y marksAttr no expuestos). Lo
    // que NO puede pasar es acusar inconsistencias que no están.
    for (const fx of ['F1', 'F2', 'F4', 'F5'] as const) {
      const { schedule } = await load(fx)
      expect(schedule.inconsistencies, `${fx} inconsistencias`).toHaveLength(0)
    }
  })
})

describe('commit 3 — contorno del ensamblado', () => {
  it('usage.calls = 2 por tabla + 1 por tabla con notas; reglas sin fuente', async () => {
    const f1 = await load('F1')
    const tablasConNotas = f1.raw.tables.filter((t) => t.notes.length > 0).length
    expect(f1.calls).toBe(f1.raw.tables.length * 2 + tablasConNotas)
  })

  it('warnings solo con códigos: sin texto de etiquetas ni encabezados (T15)', async () => {
    for (const fx of FIXTURES) {
      const { warnings } = await load(fx)
      for (const w of warnings) {
        expect(w).toMatch(/^T\d+(:[CRN]\d+)*:[a-z_]+$/)
      }
    }
  })

  it('ninguna visita ni celda con key fuera de su tabla', async () => {
    const f1 = await load('F1')
    const tableKeys = new Set(f1.schedule.tables.map((t: { key: string }) => t.key))
    for (const v of f1.schedule.visits) expect(tableKeys.has(v.tableKey)).toBe(true)
    for (const c of f1.schedule.cells) expect(tableKeys.has(c.visitKey.split('-C')[0]!)).toBe(true)
  })
})
