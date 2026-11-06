/**
 * El ensamblado RawSchedule → Schedule con el modelo simulado «perfecto»
 * (orden B-P3 §4): las métricas miden la TUBERÍA, no el modelo.
 *
 * K8: TODAS las cifras de aceptación salen del CALIFICADOR OFICIAL
 * (scripts/soa-fixtures/score.ts, PR #68) — este paquete ya no tiene
 * calificador propio. ScoreReport cuenta tp/fp/fn por métrica.
 *
 * Cifras del oficial con el modelo perfecto (medidas):
 * - visitas/ids/tipos/ventanas/celdas(nota x)/vínculos de nota: P=R=100 %.
 * - prn F2 (K7 ratificado): 100 % de PRECISIÓN (fp=0) sobre lo que el texto
 *   marca; el rango completo del gold no está dibujado en el PDF (techo
 *   documentado; P2d-3 le daría techo más alto).
 * - Residuos con causa (todos reportados): fn event/order = conditions de
 *   outOfTableRules, fuente que P2 no expone (P2d-1); fn de F2 = notas que
 *   P2 captura de más (10 de 26 impresas, P2d-2); fp population/arm =
 *   fila reimprimida por tira (el gold la declara una vez, el documento la
 *   dibuja dos); fn arm/dose_timing en celdas = el gold planta conditions
 *   en celdas que el documento no cita desde ninguna nota; fp de
 *   procedureWindow (F1=2, F2=1, F3=3) = notas «Ventana propia» impresas
 *   que el gold no planta en celda citante — techo del fixture (enmienda
 *   del gold asignada a Grok). doseTiming (G27) es CAMPO de celda:
 *   'pre'/'between' solo en citantes, null en el resto (medido F1–F5).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadPageGeometry, locateSchedule, readGrid } from '../index'
import { normalizeSchedule } from '../normalize/assemble'
import { scheduleSchema } from '../schedule-contract'
// K8: los TIPOS del calificador oficial viven en ./official-score-shapes
// (replicados — ver el encabezado de ese archivo). El VALOR entra por import
// dinámico con especificador no literal: score.ts importa clinical con
// extensión .ts (exigido por su runner con strip-types) y el tsc de este
// paquete no tiene allowImportingTsExtensions — seguirlo estáticamente
// rompería el typecheck (y scripts/soa-fixtures/** está fuera del scope de
// esta misión). La LÓGICA es siempre la del oficial.
import type { ScoreReport, ScheduleDoc } from './official-score-shapes'
import type { RawSchedule } from '../types'
import { buildPerfectLlm } from './mock-llm'

const officialScoreUrl: string = '../../../scripts/soa-fixtures/score'
const { scoreSchedule } = (await import(officialScoreUrl)) as {
  scoreSchedule: (gold: ScheduleDoc, candidate: ScheduleDoc) => ScoreReport
}

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa/', import.meta.url))
const FIXTURES = ['F1', 'F2', 'F3', 'F4', 'F5'] as const

interface Loaded {
  raw: RawSchedule
  gold: ScheduleDoc
  schedule: Awaited<ReturnType<typeof normalizeSchedule>>['schedule']
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
  const gold = JSON.parse(readFileSync(`${FIXTURES_DIR}${fixture}.gold.json`, 'utf8')) as ScheduleDoc
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

function scoreOf(entry: Loaded): ScoreReport {
  return scoreSchedule(entry.gold, entry.schedule)
}

describe('T3: visitas (identidad C1 del oficial)', () => {
  it('P = R = 100 % y 0 ids inventados en F1–F5', async () => {
    for (const fx of FIXTURES) {
      const entry = await load(fx)
      const s = scoreOf(entry)
      const goldTotal = (entry.gold.visits ?? []).length
      expect(s.visits.tp, `${fx} tp`).toBe(goldTotal)
      expect(s.visits.fp, `${fx} fp`).toBe(0)
      expect(s.visits.fn, `${fx} fn`).toBe(0)
      expect(s.printedIds.invented, `${fx} invented`).toBe(0)
      expect(s.printedIds.exact, `${fx} exact`).toBe(goldTotal)
      expect(s.printedIds.inexact, `${fx} inexact`).toBe(0)
    }
  })

  it('F3: exactamente 3 «sin número» y el ensamblado las deja en null', async () => {
    const f3 = await load('F3')
    // Las 3 son las columnas «—» de la tabla partida, con warning con código.
    const sinNumero = f3.warnings.filter((w) => w.endsWith(':sin_numero'))
    expect(sinNumero).toHaveLength(3)
    // Los «—» nunca llegan a printedId: el id NULL no es texto recortado
    // (y el oficial ya lo cuenta como exact por emparejar null↔null).
    expect(f3.schedule.visits.filter((v) => v.printedId === '—')).toHaveLength(0)
    expect(scoreOf(f3).printedIds.invented).toBe(0)
  })

  it('el Schedule completo valida contra el contrato (fail-closed del ensamblado)', async () => {
    for (const fx of FIXTURES) {
      const { schedule } = await load(fx)
      expect(scheduleSchema.safeParse(schedule).success, fx).toBe(true)
    }
  })
})

describe('T4: tipos y ventanas de visita', () => {
  it('100 % de tipos y ventanas exactas con el modelo perfecto', async () => {
    for (const fx of FIXTURES) {
      const s = scoreOf(await load(fx))
      expect(s.types.fp, `${fx} types fp`).toBe(0)
      expect(s.types.fn, `${fx} types fn`).toBe(0)
      expect(s.types.tp, `${fx} types tp`).toBeGreaterThan(0)
      expect(s.windows.fp, `${fx} windows fp`).toBe(0)
      expect(s.windows.fn, `${fx} windows fn`).toBe(0)
      expect(s.windows.tp, `${fx} windows tp`).toBeGreaterThan(0)
    }
  })

  it('el timing de F5 sale del parser determinista (D1/W2), sin modelo', async () => {
    const f5 = await load('F5')
    const d1 = f5.schedule.visits.find((v) => v.printedId === 'D1')
    const w4 = f5.schedule.visits.find((v) => v.printedId === 'W4')
    expect(d1?.timing).toMatchObject({ kind: 'scheduled', value: 1, unit: 'day' })
    expect(w4?.timing).toMatchObject({ kind: 'scheduled', value: 4, unit: 'week' })
  })

  it('ventanas exactas: ±, hasta/up to, asimétricas y «0 d» sin modelo', async () => {
    // «0 d» de F2 T1: ventana exacta del día justo.
    const f2 = await load('F2')
    const v600 = f2.schedule.visits.find((v) => v.printedId === 'V600')
    expect(v600?.window).toEqual({ before: 3, after: 3, unit: 'day' })
    const v1t1 = f2.schedule.visits.find((v) => v.tableKey === 'T1' && v.printedId === 'V1')
    expect(v1t1?.window).toEqual({ before: 0, after: 0, unit: 'day' })
    // «18–28 d» de F3 T2: rango no parseable → ventana del modelo marcada.
    const f3 = await load('F3')
    expect(f3.warnings.filter((w) => w.endsWith(':ventana_a_revisar')).length).toBeGreaterThan(0)
  })
})

describe('T5: atributos fuera de las celdas', () => {
  it('las filas Ayuno/clínica/Tipo no generan procedimiento ni celda', async () => {
    for (const fx of ['F2', 'F3'] as const) {
      const { schedule } = await load(fx)
      const attrLabels = schedule.procedures.filter((p) =>
        /^(ayuno|visita a la cl[ií]nica|tipo)/i.test(p.label.trim()),
      )
      expect(attrLabels, `${fx} procedures de atributo`).toHaveLength(0)
    }
  })

  it('attributes del oficial: F1/F5 exactos; F2/F3/F4 con techo marksAttr (P2d)', async () => {
    // El gold declara fasting/onSite/armOnly por visita; el raw no expone
    // las marcas de filas de atributo (P2 las descuenta en marksAttr). Lo
    // que no puede pasar: PRECISIÓN perdida por atributos inventados.
    for (const fx of ['F1', 'F5'] as const) {
      const s = scoreOf(await load(fx))
      expect(s.attributes.fp, `${fx} fp`).toBe(0)
      expect(s.attributes.fn, `${fx} fn`).toBe(0)
    }
    for (const fx of ['F2', 'F3', 'F4'] as const) {
      const s = scoreOf(await load(fx))
      expect(s.attributes.fp, `${fx} fp (todo fp es fn: null vs valor)`).toBe(s.attributes.fn)
      expect(s.attributes.fp, `${fx} techo marksAttr`).toBeGreaterThan(0)
    }
  })
})

describe('T6: celdas normalizadas (marca x)', () => {
  it('P = R = 100 % en F1–F5 (tp=gold, fp=fn=0)', async () => {
    for (const fx of FIXTURES) {
      const s = scoreOf(await load(fx))
      expect(s.cells.fp, `${fx} fp`).toBe(0)
      expect(s.cells.fn, `${fx} fn`).toBe(0)
      expect(s.cells.tp, `${fx} tp`).toBeGreaterThan(0)
    }
  })
})

describe('T7: prn_range de F2 (K7 ratificado: precisión sobre lo marcado)', () => {
  it('0 celdas inventadas: solo las columnas bajo el TEXTO dibujado', async () => {
    const f2 = await load('F2')
    const s = scoreOf(f2)
    // El run «según necesidad» mide ~51 pt (≈1,5 columnas) centrado en la
    // corrida: el PDF no dibuja la caja fusionada ni sombreado que comunique
    // el rango del gold (9-11 columnas). La decisión ratificada (Foreman,
    // 2026-11-06): 100 % de precisión sobre lo que el texto marca.
    expect(s.prnCells.fp).toBe(0)
    expect(s.prnCells.tp).toBe(8) // 8 corridas × la columna bajo el texto
    expect(f2.schedule.cells.filter((c) => c.mark === 'prn_range')).toHaveLength(8)
    // Cada corrida queda como duda: nada desaparece en silencio.
    expect(f2.warnings.filter((w) => w.endsWith(':prn_extension_incierta'))).toHaveLength(8)
  })

  it('sin textBBox: 0 prn_range + :prn_sin_evidencia — sin caída a la caja (G29)', async () => {
    // Condición del Architect para la dependencia temporal de textBBox
    // (P2d-3 la hará requerida): si una merged prn llega SIN textBBox, no
    // se cae a cell.bbox — esa es exactamente la expansión al ancho de
    // fila que K7 desterró (52 celdas inventadas en F2). Fail-closed.
    const f2 = await load('F2')
    const raw = structuredClone(f2.raw)
    let borrados = 0
    for (const t of raw.tables) {
      for (const c of t.cells) {
        if (c.kind === 'merged' && c.textBBox) {
          delete c.textBBox
          borrados += 1
        }
      }
    }
    expect(borrados).toBe(8)
    const out = await normalizeSchedule(raw, { llm: buildPerfectLlm({ raw, gold: f2.gold }) })
    expect(out.schedule.cells.filter((c) => c.mark === 'prn_range')).toHaveLength(0)
    expect(out.warnings.filter((w) => w.endsWith(':prn_sin_evidencia'))).toHaveLength(8)
    // El resto de la matriz no se toca (las x quedan como en la corrida sana).
    expect(out.schedule.cells.filter((c) => c.mark === 'x')).toHaveLength(
      f2.schedule.cells.filter((c) => c.mark === 'x').length,
    )
  })

  it('techo documentado: fn=72 — el rango del gold no está en el documento', async () => {
    // El gold planta 9-11 columnas por corrida (80 celdas) porque el
    // GENERADOR recortó ahí; el PDF solo dibuja el texto centrado. P=R=1,0
    // exige que el generador dibuje la caja fusionada (P2d-3).
    const s = scoreOf(await load('F2'))
    expect(s.prnCells.fn).toBe(72)
    expect(s.prnCells.tp + s.prnCells.fn).toBe(80)
  })

  it('F1/F3/F4/F5: sin corridas prn, sin celdas prn', async () => {
    for (const fx of ['F1', 'F3', 'F4', 'F5'] as const) {
      const s = scoreOf(await load(fx))
      expect(s.prnCells.fp, `${fx}`).toBe(0)
      expect(s.prnCells.tp, `${fx}`).toBe(0)
      expect(s.prnCells.fn, `${fx}`).toBe(0)
    }
  })
})

describe('T8: notas vinculadas y condiciones', () => {
  it('vínculos celda↔nota: P = R = 100 % en F1–F5 (noteRefs del oficial)', async () => {
    for (const fx of FIXTURES) {
      const s = scoreOf(await load(fx))
      expect(s.notes.fp, `${fx} fp`).toBe(0)
      expect(s.notes.fn, `${fx} fn`).toBe(0)
      expect(s.notes.tp, `${fx} tp`).toBeGreaterThan(0)
    }
  })

  it('F2: P2 captura 10 de 26 notas del gold — T8 en rojo con causa (P2d-2)', async () => {
    // Denominador GOLD (Review 00:56): el oficial cuenta VÍNCULOS celda↔nota
    // (100 % arriba), pero T8 pide ≥95 % de las NOTAS del gold. El gold
    // declara 26; el raw trae 10: el PDF las imprime y la lectura de P2
    // pierde las demás (asignado a Grok, P2d-2). Las conditions de las no
    // capturadas son fn permanente del fixture hasta que P2 las entregue.
    const f2 = await load('F2')
    expect(f2.raw.tables.reduce((n, t) => n + t.notes.length, 0)).toBe(10)
    expect((f2.gold.notes ?? []).length).toBe(26)
    const s = scoreOf(f2)
    expect(s.conditions['population']?.fn ?? 0).toBeGreaterThan(0)
  })

  it.skip('T8 ≥95 % de notas del gold — BLOQUEADO por P2d-2 (P2 entrega 10 de 26)', () => {
    // Se desbloquea cuando P2d-2 entregue las notas impresas que hoy pierde.
    // Recién entonces este umbral puede medirse; mientras, el techo real
    // está asertado en el test de arriba (10/26, con la causa).
  })

  it('dose_timing: interpretación en la NOTA (K8, 0 fp); momento como CAMPO de celda (G27)', async () => {
    // K8: la condition dose_timing vive en la nota (duplicarla en
    // c.conditions era fp). G27: el MOMENTO ('pre'/'between'/…) es campo de
    // la celda citante — dayOrder lo lee por celda (enmienda ADR-10).
    for (const fx of FIXTURES) {
      const s = scoreOf(await load(fx))
      expect(s.conditions['dose_timing']?.fp ?? 0, `${fx} fp`).toBe(0)
    }
    // F3: las 7 dose_timing del gold en notas están cubiertas; la 8ª fn es
    // la que el gold planta en una CELDA que ninguna nota cita (E55/C08).
    const f3 = await load('F3')
    const s3 = scoreOf(f3)
    expect(s3.conditions['dose_timing']?.tp).toBe(7)
    expect(s3.conditions['dose_timing']?.fn).toBe(1)
    expect(f3.schedule.notes.some((n) => n.conditions.some((c) => c.kind === 'dose_timing'))).toBe(true)
  })

  it('G27: doseTiming solo en citantes de nota dose_timing; null en el resto (medido)', async () => {
    for (const fx of FIXTURES) {
      const entry = await load(fx)
      const refsDose = new Set(
        (entry.gold.notes ?? [])
          .filter((n) => (n.conditions ?? []).some((c) => c.kind === 'dose_timing'))
          .map((n) => n.ref),
      )
      const conDt = entry.schedule.cells.filter((c) => c.doseTiming !== null)
      // Invariante G27: una celda SOLO tiene momento si cita una nota
      // dose_timing — nunca de la nada.
      for (const c of conDt) {
        expect(c.noteRefs.some((r) => refsDose.has(r)), `${fx} ${c.visitKey}`).toBe(true)
      }
      // Cifras medidas con el modelo perfecto:
      // F1: 3 pre (refs 4/14 «Antes de la dosis») + 2 between (ref 5).
      // F2: 1+1 · F3: 3+3 · F4: 1+1 · F5: 0 (sus notas d/e no las cita
      // ninguna celda — fail-closed: campo null).
      const esperado: Record<string, [number, number]> = {
        F1: [3, 2],
        F2: [1, 1],
        F3: [3, 3],
        F4: [1, 1],
        F5: [0, 0],
      }
      const [pre, between] = esperado[fx]!
      expect(conDt.filter((c) => c.doseTiming === 'pre'), `${fx} pre`).toHaveLength(pre)
      expect(conDt.filter((c) => c.doseTiming === 'between'), `${fx} between`).toHaveLength(between)
    }
    // El resto del contrato: TODA celda lleva el campo (null si no cita).
    for (const fx of FIXTURES) {
      const e = await load(fx)
      const citantes = new Set(
        e.schedule.cells.flatMap((c) =>
          c.doseTiming !== null ? [`${c.procedureKey}@${c.visitKey}`] : [],
        ),
      )
      const noCitantes = e.schedule.cells.filter(
        (c) => !citantes.has(`${c.procedureKey}@${c.visitKey}`),
      )
      for (const c of noCitantes) expect(c.doseTiming, `${fx} ${c.visitKey}`).toBeNull()
    }
  })

  it('conditions event/order: fn solo por outOfTableRules (fuente P2d-1)', async () => {
    // El gold declara las conditions de las reglas fuera de tabla; P2 no
    // expone esos párrafos. El fn exacto por fixture = lo que hay en rules.
    for (const fx of FIXTURES) {
      const entry = await load(fx)
      const s = scoreOf(entry)
      const rulesByKind = new Map<string, number>()
      for (const rule of entry.gold.outOfTableRules ?? []) {
        for (const c of rule.conditions ?? []) {
          rulesByKind.set(c.kind, (rulesByKind.get(c.kind) ?? 0) + 1)
        }
      }
      for (const kind of ['event', 'order'] as const) {
        const fn = s.conditions[kind]?.fn ?? 0
        expect(fn, `${fx} ${kind} fn`).toBe(rulesByKind.get(kind) ?? 0)
        expect(s.conditions[kind]?.fp ?? 0, `${fx} ${kind} fp`).toBe(0)
      }
    }
  })

  it('C4: las conditions de fila del gold llegan a sus procedures', async () => {
    // F3 trae 4 (solo subgrupo X / solo brazo A / solo brazo B).
    const f3 = await load('F3')
    const conProcedimiento = f3.schedule.procedures.filter(
      (p) => p.conditions.length > 0 && /solo (subgrupo|brazo)/i.test(p.label),
    )
    expect(conProcedimiento.length).toBeGreaterThanOrEqual(4)
    for (const p of conProcedimiento) {
      for (const c of p.conditions) {
        expect(c.kind === 'population' || c.kind === 'arm', JSON.stringify(c)).toBe(true)
      }
    }
  })

  it('recall de conditions con fuente: population/fasting 100 %; fn(arm) = techo exacto', async () => {
    // F1/F3/F5 capturan todas sus notas (sin techo P2d-2). El fn residual
    // de arm es EXACTAMENTE el que el gold planta en CELDAS (el generador
    // las ubica directo, sin nota que las cite): techo medible del gold.
    for (const fx of ['F1', 'F3', 'F5'] as const) {
      const entry = await load(fx)
      const s = scoreOf(entry)
      const armEnCeldas = (entry.gold.cells ?? []).reduce(
        (n, c) => n + (c.conditions ?? []).filter((k) => k.kind === 'arm').length,
        0,
      )
      expect(s.conditions['arm']?.fn ?? 0, `${fx} arm fn = en-celdas del gold`).toBe(armEnCeldas)
      for (const kind of ['population', 'fasting'] as const) {
        const c = s.conditions[kind]!
        if (c.tp + c.fn === 0) continue
        expect(c.fn, `${fx} ${kind} fn`).toBe(0)
      }
    }
  })
})

describe('T9: ventana propia de procedimiento (G27 #2)', () => {
  it('cifras exactas por fixture; TODA celda con ventana CITA la nota (medido)', async () => {
    // Medido con el modelo perfecto (Review 00:56 + corrida propia):
    // F1=2, F2=1, F3=3, F4/F5=0. Contra el gold (que solo F3 planta, 1):
    // la única celda con window del gold (F3, E55/S1-C08) tiene
    // noteRefs=[] — NO cita la nota. La ventana del gold no es alcanzable
    // por la vía citante: techo del fixture, la enmienda del gold de la
    // ventana −4/+2 está asignada a Grok. Lo que T9 exige hoy: el campo
    // llega con el VALOR correcto y SOLO a celdas que citan la nota.
    const esperado: Record<string, number> = { F1: 2, F2: 1, F3: 3, F4: 0, F5: 0 }
    for (const fx of FIXTURES) {
      const entry = await load(fx)
      const refsVentana = new Set(
        (entry.gold.notes ?? [])
          .filter((n) => /ventana propia/i.test(n.text ?? ''))
          .map((n) => n.ref),
      )
      const conPw = entry.schedule.cells.filter((c) => c.procedureWindow !== null)
      expect(conPw, `${fx} cantidad`).toHaveLength(esperado[fx]!)
      for (const c of conPw) {
        expect(c.procedureWindow, `${fx} ${c.visitKey} valor`).toEqual({
          before: 4,
          after: 2,
          unit: 'week',
        })
        expect(
          c.noteRefs.some((r) => refsVentana.has(r)),
          `${fx} ${c.visitKey} cita la nota: ${JSON.stringify(c.noteRefs)}`,
        ).toBe(true)
      }
    }
  })
})

describe('T11: inconsistencias deterministas (alcance medido)', () => {
  // Métrica VIGENTE del oficial: inconsistencias por KIND (score.ts:776-783).
  // La exigencia de T11 por INSTANCIA (cuál fila, cuál nota) necesita que el
  // calificador las cuente una por una — asignado a Grok (P2d). Hasta
  // entonces este bloque mide lo que el oficial mide.
  it.skip('T11 por instancia — BLOQUEADO por el calificador oficial (cuenta por kind)', () => {
    // Se desbloquea con el score.ts por instancia (Grok, P2d): tp/fp/fn
    // por inconsistencia individual, no por clase.
  })

  it('F3 detecta duplicated_row y prose_vs_table_limit impresa en la nota (por kind)', async () => {
    const f3 = await load('F3')
    const kinds = new Set(f3.schedule.inconsistencies.map((i) => i.kind))
    expect(kinds.has('duplicated_row')).toBe(true)
    expect(kinds.has('prose_vs_table_limit')).toBe(true)
    const s = scoreOf(f3)
    expect(s.inconsistencies.tp).toBe(2)
    expect(s.inconsistencies.fp).toBe(0)
    // La descripción viaja con códigos, sin texto del documento.
    for (const i of f3.schedule.inconsistencies) {
      expect(i.description).toMatch(/^T\d+:(R\d+\/R\d+|N\d+):[a-z_]+$/)
    }
  })

  it('cero inconsistencias inventadas en F1–F5; fn = plantadas sin fuente (P2d)', async () => {
    // El techo medido (reportado): los detectores solo ven el raw actual.
    // Lo que NO puede pasar es acusar inconsistencias que no están.
    for (const fx of FIXTURES) {
      const entry = await load(fx)
      const s = scoreOf(entry)
      expect(s.inconsistencies.fp, `${fx} fp`).toBe(0)
      const plantadas = (entry.gold.inconsistencies ?? []).length
      expect(s.inconsistencies.fn, `${fx} fn`).toBe(plantadas - s.inconsistencies.tp)
    }
  })
})

describe('T12: outcome de P2 propagado', () => {
  it('la tabla partial del raw llega partial (nunca complete) con motivo', async () => {
    const f2 = await load('F2')
    const partial = f2.schedule.tables.find((t) => t.outcome === 'partial')
    expect(partial).toBeDefined()
    expect(partial?.reasons.length ?? 0).toBeGreaterThan(0)
    // El resto de las tablas de F2 y todos los outcomes de F1/F3/F4/F5
    // viajan tal cual los reportó P2.
    expect(f2.schedule.tables.filter((t) => t.outcome !== 'complete')).toHaveLength(
      f2.raw.tables.filter((t) => t.outcome !== 'complete').length,
    )
    for (const fx of ['F1', 'F3', 'F4', 'F5'] as const) {
      const entry = await load(fx)
      expect(entry.schedule.tables.filter((t) => t.outcome !== 'complete')).toHaveLength(
        entry.raw.tables.filter((t) => t.outcome !== 'complete').length,
      )
    }
  })
})

describe('contorno del ensamblado', () => {
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
    const tableKeys = new Set(f1.schedule.tables.map((t) => t.key))
    for (const v of f1.schedule.visits) expect(tableKeys.has(v.tableKey)).toBe(true)
    for (const c of f1.schedule.cells) expect(tableKeys.has(c.visitKey.split('-C')[0]!)).toBe(true)
  })
})
