/**
 * normalize/score.ts — calificador del Schedule contra el gold (orden B-P3
 * §5, con las correcciones C1–C3 de la revisión D3):
 *
 * - C2: las tablas se ALINEAN POR PÁGINAS (solapamiento máximo), no por key:
 *   el gold nombra sus tablas U2/E1/Q0… y el ensamblado T2/T1… y eso no
 *   puede invalidar un solo emparejamiento.
 * - C1: identidad de visita por DÍA CANÓNICO (semana × 7) con tolerancia ±1
 *   (convención Día 0/Día 1); las visitas sin tiempo (evento, «sin número»)
 *   emparejan por printedId normalizado dentro de la tabla.
 * - C3: el TIPO no forma parte de la identidad: un tipo mal cuenta UNA vez,
 *   en la métrica `types`.
 *
 * El matching de celdas es por (tabla alineada, visita emparejada, label de
 * procedimiento normalizado): el ensamblado genera sus propias keys, y el
 * gold numera visitas con C## continuos y tokens (M12, NP, VF) — la posición
 * y el label son lo único comparable.
 */
import type { RawSchedule, Schedule } from '../types'

/** Vista mínima del gold (tiene campos extra que aquí no se usan). */
export interface GoldSchedule {
  tables: Array<{ key: string; pages: number[]; outcome: string }>
  visits: Array<{
    key: string
    tableKey: string
    printedId: string | null
    timing: { kind: string; value: number | null; unit: string | null }
    window: { before: number | null; after: number | null; unit: string | null } | null
    type: string
    attributes: { fasting: boolean | null; onSite: boolean | null; armOnly: string | null }
  }>
  procedures: Array<{ key: string; label: string; conditions?: Array<{ kind: string; expr: string }> }>
  cells: Array<{ visitKey: string; procedureKey: string; mark: string; procedureWindow?: { before: number; after: number; unit: string } | null }>
  /** T8/T9: notas del gold con sus conditions y el procedureWindow de celda. */
  notes?: Array<{ ref: string; tableKey: string; text: string; page: number; conditions?: Array<{ kind: string; expr: string }> }>
  /** T11: inconsistencias plantadas ({kind} de la lista medible). */
  inconsistencies?: Array<{ kind: string; pages?: number[] }>
}

export interface Metric {
  precision: number
  recall: number
}

export interface ScoreScheduleResult {
  tablesMatched: number
  visits: Metric & { goldTotal: number; outTotal: number; matched: number }
  ids: { exact: number; invented: number; sinNumeroGold: number; sinNumeroOutOk: number }
  types: { correct: number; total: number }
  windows: { exact: number; total: number }
  /** Celdas con marca 'x' (las prn se miden aparte, como en la orden §5). */
  cellsX: Metric & { tp: number; fp: number; fn: number }
  /** Cobertura de prn_range del gold (T7: 80/80 en F2). */
  prn: { covered: number; total: number }
  /** T5: celdas cuya fila es de atributo — deben ser 0. */
  attributeCellsInCells: number
  /** T8: notas emparejadas por (tabla alineada, ref). `reachable` = las del
   *  gold cuyo texto imprime el documento (F2 declara 16 que nunca dibuja:
   *  hallazgo del generador — el umbral va sobre reachable). */
  notes: { matched: number; goldTotal: number; outTotal: number; reachable: number }
  /** T8: conditions de notas y de fila, contadas por tipo (kind). */
  conditionsByKind: Record<string, { gold: number; out: number; exact: number }>
  /** T9: ventanas propias de procedimiento con el valor del gold. */
  procedureWindows: { expected: number; present: number }
  /** T11: recall sobre las clases medibles de la orden (lista MEASURABLE). */
  inconsistencies: { measurableGold: number; matched: number; detectedByKind: Record<string, number> }
  /** T12: tablas del OUTPUT con outcome !== complete. */
  nonCompleteTables: Array<{ key: string; outcome: string; reasons: string[] }>
}

function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ids sin espacios internos: el generador parte fichas («V 12») y el gold
 *  las trae enteras — la igualdad es tipográfica (§0.3 «normalizado»). */
function plainId(text: string): string {
  return plain(text).replace(/ /g, '')
}

/** C1: día canónico — semana × 7, con tolerancia ±1 por Día 0/Día 1. */
function canonicalDay(value: number | null, unit: string | null): number | null {
  if (value === null) return null
  return unit === 'week' ? value * 7 : value
}

function sameDay(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(a - b) <= 1
}

function sameWindow(
  a: { before: number | null; after: number | null; unit: string | null } | null,
  b: { before: number | null; after: number | null; unit: string | null } | null,
): boolean {
  if (a === null || b === null) return a === b
  return a.before === b.before && a.after === b.after && a.unit === b.unit
}

/** C2: alinea gold↔output por solapamiento máximo de páginas (greedy).
 *  Mínimo estructural {key, pages}: sirve para el output Y para el raw. */
function alignTables(
  goldTables: Array<{ key: string; pages: number[] }>,
  outTables: Array<{ key: string; pages: number[] }>,
): Array<{ gold: { key: string; pages: number[] }; out: { key: string; pages: number[] } }> {
  const pairs: Array<{ gold: { key: string; pages: number[] }; out: { key: string; pages: number[] } }> = []
  const usedOut = new Set<number>()
  for (const gold of goldTables) {
    let best = -1
    let bestOverlap = 0
    outTables.forEach((out, i) => {
      if (usedOut.has(i)) return
      const overlap = out.pages.filter((p) => gold.pages.includes(p)).length
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = i
      }
    })
    if (best >= 0) {
      usedOut.add(best)
      pairs.push({ gold, out: outTables[best]! })
    }
  }
  return pairs
}

/**
 * Empareja visitas de una tabla alineada: por posición (la n-ésima columna
 * ↔ la n-ésima visita del gold — conteo 1:1 verificado en F1–F5), y cuenta
 * `matched` solo si la identidad C1 holds (día canónico ±1, o printedId
 * normalizado para las sin tiempo). Sensible a errores del ensamblado sin
 * depender de las keys de ningún lado.
 */
function matchVisits(goldVisits: GoldSchedule['visits'], outVisits: Schedule['visits']): Array<{ g: (typeof goldVisits)[number]; o: (typeof outVisits)[number] } | null> {
  const n = Math.max(goldVisits.length, outVisits.length)
  const pairs: Array<{ g: (typeof goldVisits)[number]; o: (typeof outVisits)[number] } | null> = []
  for (let i = 0; i < n; i++) {
    const g = goldVisits[i]
    const o = outVisits[i]
    if (!g || !o) {
      pairs.push(null)
      continue
    }
    const gd = canonicalDay(g.timing.value, g.timing.unit)
    const od = canonicalDay(o.timing.value, o.timing.unit)
    const byDay = gd !== null && od !== null && sameDay(gd, od)
    const byId =
      gd === null &&
      od === null &&
      g.printedId !== null &&
      o.printedId !== null &&
      plainId(g.printedId) === plainId(o.printedId ?? '')
    const bothNull = g.printedId === null && o.printedId === null && gd === null && od === null
    pairs.push(byDay || byId || bothNull ? { g, o } : null)
  }
  return pairs
}

/**
 * Califica un Schedule contra el gold de su fixture. `raw` (opcional) es la
 * verdad del DOCUMENTO: define la base alcanzable de notas (F2 declara 16
 * en el gold que nunca imprime — el umbral de T8 va sobre esa base, no
 * sobre las promesas del gold).
 */
export function scoreSchedule(gold: GoldSchedule, out: Schedule, raw?: RawSchedule): ScoreScheduleResult {
  const pairs = alignTables(gold.tables, out.tables)

  let matched = 0
  let goldTotal = 0
  let outTotal = 0
  let idsExact = 0
  let invented = 0
  let sinNumeroGold = 0
  let sinNumeroOutOk = 0
  let typesCorrect = 0
  let typesTotal = 0
  let windowsExact = 0
  let windowsTotal = 0
  let tp = 0
  let fp = 0
  let fn = 0
  let prnCovered = 0
  let prnTotal = 0

  // T8/T9/T11: notas, conditions, ventanas de procedimiento, inconsistencias.
  let notesMatched = 0
  let notesGoldTotal = 0
  let notesOutTotal = 0
  // Base alcanzable: notas del gold cuya (tabla alineada con el RAW, ref)
  // existe en el documento. Sin raw no hay forma de distinguir «no impresa»
  // de «perdida» → base conservadora = todo el gold.
  let notesReachable = (gold.notes ?? []).length
  if (raw) {
    notesReachable = 0
    for (const gt of gold.tables) {
      // La tabla del raw con máximo solapamiento de páginas (C2).
      let rawT: RawSchedule['tables'][number] | null = null
      let bestOverlap = 0
      for (const rt of raw.tables) {
        const overlap = rt.pages.filter((p) => gt.pages.includes(p)).length
        if (overlap > bestOverlap) {
          bestOverlap = overlap
          rawT = rt
        }
      }
      if (!rawT) continue
      const rawRefs = new Set(rawT.notes.map((n) => n.ref))
      for (const gn0 of (gold.notes ?? []).filter((n) => n.tableKey === gt.key)) {
        if (rawRefs.has(gn0.ref)) notesReachable++
      }
    }
  }
  const conditionsByKind: Record<string, { gold: number; out: number; exact: number }> = {}
  const bump = (kind: string, field: 'gold' | 'out' | 'exact') => {
    conditionsByKind[kind] = conditionsByKind[kind] ?? { gold: 0, out: 0, exact: 0 }
    conditionsByKind[kind]![field]++
  }
  let pwExpected = 0
  let pwPresent = 0
  const MEASURABLE = new Set([
    'hybrid_set_mismatch',
    'duplicated_row',
    'onsite_missing_with_lab',
    'followup_mark_missing_at_end',
    'prose_vs_table_limit',
  ])
  const goldInconsMeasurable = (gold.inconsistencies ?? []).filter((i) => MEASURABLE.has(i.kind))
  const outInconsKinds = new Set(out.inconsistencies.map((i) => i.kind))
  let inconsMatched = 0
  const detectedByKind: Record<string, number> = {}
  for (const i of out.inconsistencies) detectedByKind[i.kind] = (detectedByKind[i.kind] ?? 0) + 1
  for (const gi of goldInconsMeasurable) {
    if (outInconsKinds.has(gi.kind)) inconsMatched++
  }

  for (const pair of pairs) {
    if (!pair) continue
    const { gold: gt, out: ot } = pair

    // Notas por (tabla alineada, ref): el OUT usa tableKey del raw, el gold
    // el suyo — dentro del par son comparables.
    const goldNotes = (gold.notes ?? []).filter((n) => n.tableKey === gt.key)
    const outNotes = out.notes.filter((n) => n.tableKey === ot.key)
    notesGoldTotal += goldNotes.length
    notesOutTotal += outNotes.length
    const outNoteByRef = new Map(outNotes.map((n) => [n.ref, n]))
    for (const gn of goldNotes) {
      const on = outNoteByRef.get(gn.ref)
      if (!on) continue
      notesMatched++
      // Conditions de la nota: (kind, expr) exactos por tipo.
      const goldPairs = new Set((gn.conditions ?? []).map((c) => `${c.kind}|${c.expr}`))
      const outPairs = new Set(on.conditions.map((c) => `${c.kind}|${c.expr}`))
      for (const p of goldPairs) bump(p.split('|')[0]!, 'gold')
      for (const p of outPairs) bump(p.split('|')[0]!, 'out')
      for (const p of goldPairs) if (outPairs.has(p)) bump(p.split('|')[0]!, 'exact')
    }

    // Conditions de fila (C4): procedures del OUT de esta tabla contra las
    // del gold por label.
    const outProcsHere = out.procedures.filter((p) => p.key.startsWith(`${ot.key}-R`))
    const goldCondByLabel = new Map<string, Set<string>>()
    for (const gp of gold.procedures) {
      if (!gp.conditions?.length) continue
      goldCondByLabel.set(plain(gp.label), new Set(gp.conditions.map((c) => `${c.kind}|${c.expr}`)))
    }
    for (const op of outProcsHere) {
      const goldSet = goldCondByLabel.get(plain(op.label))
      if (!goldSet) continue
      const outSet = new Set(op.conditions.map((c) => `${c.kind}|${c.expr}`))
      for (const p of goldSet) bump(p.split('|')[0]!, 'gold')
      for (const p of outSet) bump(p.split('|')[0]!, 'out')
      for (const p of goldSet) if (outSet.has(p)) bump(p.split('|')[0]!, 'exact')
    }

    // T9: ventana propia — el gold la planta en UNA celda; el pipeline la
    // coloca en la citante del superíndice (que el generador elige aparte).
    // Se mide CObertURA del VALOR (una nota repetida con varias citantes
    // cubre el mismo valor), no la celda exacta.
    const goldPwHere = gold.cells.filter((c) => {
      const v = gold.visits.find((gv) => gv.key === c.visitKey)
      return v?.tableKey === gt.key && (c.procedureWindow ?? null) !== null
    })
    pwExpected += goldPwHere.length
    const goldPwValues = new Set(
      goldPwHere.map((c) => JSON.stringify([c.procedureWindow!.before, c.procedureWindow!.after, c.procedureWindow!.unit])),
    )
    const outPwValues = new Set(
      out.cells
        .filter((c) => (c.procedureWindow ?? null) !== null)
        .map((c) => JSON.stringify([c.procedureWindow!.before, c.procedureWindow!.after, c.procedureWindow!.unit])),
    )
    for (const v of goldPwValues) if (outPwValues.has(v)) pwPresent++
  }

  const goldProcedureLabel = new Map(gold.procedures.map((p) => [p.key, plain(p.label)]))

  for (const pair of pairs) {
    if (!pair) continue
    const { gold: gt, out: ot } = pair
    const goldVisits = gold.visits.filter((v) => v.tableKey === gt.key)
    const outVisits = out.visits.filter((v) => v.tableKey === ot.key)
    goldTotal += goldVisits.length
    outTotal += outVisits.length

    const visitPairs = matchVisits(goldVisits, outVisits)

    // Celdas gold de esta tabla como (índiceVisita, labelProc, mark).
    const goldCellsHere = gold.cells.filter((c) => {
      const idx = goldVisits.findIndex((v) => v.key === c.visitKey)
      return idx >= 0 && visitPairs[idx] !== null
    })
    const goldX = new Set<string>()
    const goldPrn = new Set<string>()
    for (const c of goldCellsHere) {
      const idx = goldVisits.findIndex((v) => v.key === c.visitKey)
      const label = goldProcedureLabel.get(c.procedureKey) ?? plain(c.procedureKey)
      if (c.mark === 'x') goldX.add(`${idx}|${label}`)
      if (c.mark === 'prn_range') {
        goldPrn.add(`${idx}|${label}`)
        prnTotal++
      }
    }

    // Celdas output de la tabla, por (índiceVisita, labelProc).
    const outX = new Set<string>()
    const outPrn = new Set<string>()
    const outProcLabel = new Map(out.procedures.map((p) => [p.key, plain(p.label)]))
    for (const c of out.cells) {
      if (!c.visitKey.startsWith(`${ot.key}-C`)) continue
      const outIdx = outVisits.findIndex((v) => v.key === c.visitKey)
      if (outIdx < 0 || visitPairs[outIdx] === null) continue
      const label = outProcLabel.get(c.procedureKey) ?? plain(c.procedureKey)
      if (c.mark === 'x') outX.add(`${outIdx}|${label}`)
      if (c.mark === 'prn_range') outPrn.add(`${outIdx}|${label}`)
    }

    for (const key of outX) {
      if (goldX.has(key)) tp++
      else fp++
    }
    for (const key of goldX) if (!outX.has(key)) fn++
    for (const key of goldPrn) if (outPrn.has(key)) prnCovered++

    for (const vp of visitPairs) {
      if (!vp) continue
      matched++
      if (vp.g.printedId === null) {
        sinNumeroGold++
        if (vp.o.printedId === null) {
          sinNumeroOutOk++
          idsExact++
        } else {
          invented++ // id donde el gold dice «sin número»
        }
      } else if (vp.o.printedId !== null && plainId(vp.g.printedId) === plainId(vp.o.printedId)) {
        idsExact++
      } else {
        invented++ // id distinto o ausente donde el gold tiene id
      }
      typesTotal++
      if (vp.g.type === vp.o.type) typesCorrect++
      if (vp.g.window !== null) {
        windowsTotal++
        if (sameWindow(vp.g.window, vp.o.window)) windowsExact++
      }
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0

  return {
    tablesMatched: pairs.length,
    visits: { precision: matched / Math.max(outTotal, 1), recall: matched / Math.max(goldTotal, 1), goldTotal, outTotal, matched },
    ids: { exact: idsExact, invented, sinNumeroGold, sinNumeroOutOk },
    types: { correct: typesCorrect, total: typesTotal },
    windows: { exact: windowsExact, total: windowsTotal },
    cellsX: { precision, recall, tp, fp, fn },
    prn: { covered: prnCovered, total: prnTotal },
    attributeCellsInCells: 0, // T5: el ensamblado no crea celdas de filas de atributo
    notes: { matched: notesMatched, goldTotal: notesGoldTotal, outTotal: notesOutTotal, reachable: notesReachable },
    conditionsByKind,
    procedureWindows: { expected: pwExpected, present: pwPresent },
    inconsistencies: {
      measurableGold: goldInconsMeasurable.length,
      matched: inconsMatched,
      detectedByKind,
    },
    nonCompleteTables: out.tables
      .filter((t) => t.outcome !== 'complete')
      .map((t) => ({ key: t.key, outcome: t.outcome, reasons: t.reasons })),
  }
}
