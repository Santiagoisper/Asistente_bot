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
import type { Schedule } from '../types'

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
  procedures: Array<{ key: string; label: string }>
  cells: Array<{ visitKey: string; procedureKey: string; mark: string }>
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

/** C2: alinea gold↔output por solapamiento máximo de páginas (greedy). */
function alignTables(
  goldTables: GoldSchedule['tables'],
  outTables: Schedule['tables'],
): Array<{ gold: GoldSchedule['tables'][number]; out: Schedule['tables'][number] } | null> {
  const pairs: Array<{ gold: GoldSchedule['tables'][number]; out: Schedule['tables'][number] }> = []
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

/** Califica un Schedule contra el gold de su fixture. */
export function scoreSchedule(gold: GoldSchedule, out: Schedule): ScoreScheduleResult {
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
    nonCompleteTables: out.tables
      .filter((t) => t.outcome !== 'complete')
      .map((t) => ({ key: t.key, outcome: t.outcome, reasons: t.reasons })),
  }
}
