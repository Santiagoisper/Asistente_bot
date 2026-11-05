/**
 * normalize/assemble.ts — el ENSAMBLADO (P3, orden B-P3 §0-§2): RawSchedule +
 * respuestas del modelo → Schedule (contrato ADR-10 §3). La matriz la arma
 * ESTE código cruzando el raw con índices/spans/enums; el modelo nunca la
 * devolvió.
 *
 * Verificado contra el dump real de P2 sobre F1–F5 (medido, no supuesto):
 * - `headerSource='prefixed'` → headerText ES la ficha («V1», «FA-SEG»,
 *   «SCR»): printedId determinista sin modelo. Los «—» de F3 (3 columnas U)
 *   no son id → null + «sin número» (T3).
 * - La fila «Ventana» aparece VARIAS veces como row (separador de tiras);
 *   se excluye por label además del windowRow.rowIndex. «Continúa en la
 *   página siguiente» es paginación, no procedimiento.
 * - Filas `continuedFromPrevPage` comparten rowIndex con la original: una
 *   sola fila de procedimiento, celdas de ambas páginas.
 * - `merged` con «según necesidad»/«as needed» = corrida prn: se expande a
 *   prn_range por columna del span (la cadena vive centrada en la corrida;
 *   sus extremos no sobreviven al raw — la cobertura del gold queda entera,
 *   T7, y la confianza penaliza la combinada ×0,9, §3).
 * - P2 DESCARTA las marcas de filas de atributo (grid.ts marksAttr): hasta
 *   que P2 las exponga, attributes queda null — ausencia, no invención.
 *
 * Nada desaparece en silencio: todo descarte suma un warning con CÓDIGOS
 * (tableKey/col/row + motivo corto), nunca texto del documento (S8/T15).
 */
import type { RawSchedule, RawTable, Schedule } from '../types'
import type { ScheduleTable, Visit, Procedure, Cell } from '../schedule-contract'
import { scheduleSchema } from '../schedule-contract'
import type { HeadersInput, LlmPort, RowsInput } from './llm-steps'
import { parseTiming } from './timing'
import { parseWindow } from './window'

/** Labels de fila que son infraestructura, no procedimientos (medidos). */
const WINDOW_ROW_RE = /^(ventana|visit window|margen de visita|window)$/i
const CONTINUES_RE = /contin[uú]a en la p[aá]gina siguiente|continues on (the )?next page/i

/** Tipos cuya visita no tiene tiempo programado: el timing es evento. */
const EVENT_TYPES = new Set(['early_termination', 'unscheduled', 'end_of_study'])

/** ¿El texto de ventana dice «no hay ventana» en vez de «no la entendí»?
 *  «±» pelado (F4) y «window» sin magnitud (F5 T2) NO son ausencia: el gold
 *  trae ventana real que el PDF no imprimió con valor — van al modelo y
 *  quedan «a revisar» (K6). */
const NO_WINDOW_RE = /^(?:n\/?[ca]|nc|na|-)$/i

export interface NormalizeResult {
  schedule: Schedule
  /** Códigos `T2:C03:…` — sin texto del documento (S8). */
  warnings: string[]
  usage: { calls: number; inputTokens: number; outputTokens: number }
}

/** Confianza de celda literal de la orden §3 (la calibración es commit 6). */
function cellConfidence(
  distanceToCenter: number,
  merged: boolean,
  checksPass: boolean,
  printedIdVerified: boolean,
): number {
  let c = 1 - Math.min(Math.max(distanceToCenter, 0), 1)
  if (merged) c *= 0.9
  if (!checksPass) c *= 0.6
  if (!printedIdVerified) c *= 0.9
  return Math.round(c * 1000) / 1000
}

function plainNorm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Texto de la celda de fila de ventana que cubre la columna (directa o por
 *  span). F3 partido en tiras repite la fila «Ventana» por tira y F5 alterna
 *  filas de etiqueta («window») con filas de valor: se prefiere la celda que
 *  PARSEA como ventana; si ninguna, la primera cubierta (etiqueta/ausencia). */
function windowTextFor(
  table: RawTable,
  colIndex: number,
  windowRowIndexes: Set<number>,
): string {
  let first = ''
  for (const cell of table.cells) {
    if (!windowRowIndexes.has(cell.rowIndex)) continue
    if (cell.colIndex !== colIndex && !cell.spanCols.includes(colIndex)) continue
    if (first === '') first = cell.text
    if (parseWindow(cell.text) !== null) return cell.text
  }
  return first
}

/** Id determinista: la ficha prefixed ES el id («—» y vacío no lo son).
 *  Los espacios internos se colapsan (§0.3 «normalizado»: F1 imprime la
 *  ficha partida «V 12» y el id es V12) — normalización tipográfica, no
 *  texto nuevo. */
function printedIdDeterministic(headerText: string): string | null {
  const chip = headerText.trim().replace(/\s+/g, '')
  if (chip.length === 0 || chip === '—' || /^[-–—_.]+$/.test(chip)) return null
  return chip
}

/**
 * Ensamblado de UNA tabla → {visits, procedures, cells} + warnings. El
 * determinista primero (§0.2): printedId/window/timing por código; el modelo
 * completa lo que el parser no pudo y eso queda marcado.
 */
async function assembleTable(
  table: RawTable,
  llm: LlmPort,
  warnings: string[],
): Promise<{ visits: Visit[]; procedures: Procedure[]; cells: Cell[]; calls: number }> {
  const checksPass = table.checks.every((c) => c.pass)
  const windowRowIndex = table.windowRow?.rowIndex ?? -1

  // Filas de ventana: la capturada por P2 MÁS las repetidas por tira (F3:
  // «Ventana» en cada tira — todas son fuente de ventana, ninguna fila más).
  const windowRowIndexes = new Set<number>()
  if (windowRowIndex >= 0) windowRowIndexes.add(windowRowIndex)
  for (const r of table.rows) {
    if (WINDOW_ROW_RE.test(plainNorm(r.label))) windowRowIndexes.add(r.index)
  }

  // ── classifyHeaders: entrada por columna con su ventana de la fila ──────
  const headersInput: HeadersInput = {
    tableKey: table.key,
    tableTitle: '',
    headers: table.columns.map((col) => ({
      col: col.index,
      headerText: col.headerText,
      timeText: '',
      windowText: windowTextFor(table, col.index, windowRowIndexes),
    })),
  }
  const headersOut = await llm.classifyHeaders(headersInput)
  const headerByCol = new Map(headersOut.headers.map((h) => [h.col, h]))

  // ── classifyRows: filas útiles (sin ventana/paginación/continuadas) ─────
  const usableRows = table.rows.filter(
    (r) =>
      r.index !== windowRowIndex &&
      !r.continuedFromPrevPage &&
      !WINDOW_ROW_RE.test(plainNorm(r.label)) &&
      !CONTINUES_RE.test(plainNorm(r.label)),
  )
  const rowsInput: RowsInput = {
    tableKey: table.key,
    rows: usableRows.map((r) => ({
      row: r.index,
      label: r.label,
      hasMarks: table.cells.some((c) => c.rowIndex === r.index && c.kind === 'mark'),
      commentText: '',
    })),
  }
  const rowsOut = await llm.classifyRows(rowsInput)
  const kindByRow = new Map(rowsOut.rows.map((r) => [r.row, r]))

  // Filas de atributo: informan attributes, no son procedimientos (T5). P2
  // aún no expone sus marcas (marksAttr en grid.ts): el gancho queda listo.
  const attributeKinds = new Set(['attribute_fasting', 'attribute_onsite', 'attribute_visit_type'])

  // ── Procedures: filas kind=procedure (la sección corrida las agrupa) ────
  const procedures: Procedure[] = []
  const procedureRows = new Set<number>()
  let section: string | null = null
  for (const row of usableRows) {
    const kind = kindByRow.get(row.index)?.kind
    if (kind === 'section') {
      section = row.label.slice(0, 64)
      continue
    }
    if (kind !== 'procedure') continue
    procedureRows.add(row.index)
    procedures.push({
      key: `${table.key}-R${String(row.index).padStart(2, '0')}`,
      label: row.label,
      section,
      kind: 'procedure',
      conditions: [], // commit 4: classifyRows.conditions + notas de fila
      source: { page: row.page, bbox: row.labelBBox },
    })
  }
  const procedureKeyByRow = new Map<number, string>()
  for (const p of procedures) {
    const rowIdx = Number(p.key.slice(p.key.indexOf('-R') + 2))
    procedureKeyByRow.set(rowIdx, p.key)
  }

  // ── Visits: una por columna ─────────────────────────────────────────────
  const visits: Visit[] = []
  const visitKeyByCol = new Map<number, string>()
  for (const col of table.columns) {
    const h = headerByCol.get(col.index)
    if (!h) {
      warnings.push(`${table.key}:C${col.index}:header_sin_respuesta`)
    }

    // printedId: determinista primero; el span del modelo SOLO como recorte
    // validado del headerText (R3: tiene que aparecer en el texto).
    let printedId = printedIdDeterministic(col.headerText)
    let printedIdVerified = printedId !== null
    if (printedId === null && h?.printedIdSpan) {
      const [start, end] = h.printedIdSpan
      const cut =
        start < end && end <= col.headerText.length
          ? col.headerText.slice(start, end).trim().replace(/\s+/g, '')
          : ''
      if (cut.length > 0) {
        printedId = cut
        printedIdVerified = true
      } else {
        warnings.push(`${table.key}:C${col.index}:span_invalido_descartado`)
      }
    }
    if (printedId === null) {
      // prefixed «—» o numeric_visit/numeric_time: el entero es número u
      // hora, NUNCA id (K2) — «sin número», no inventado.
      warnings.push(`${table.key}:C${col.index}:sin_numero`)
    }

    // timing: parser primero; si no puede, el modelo; si no, evento por tipo.
    let timing = parseTiming(col.headerText)
    if (!timing && h?.timingIfUnparsed) {
      timing = { kind: 'scheduled', value: h.timingIfUnparsed.value, unit: h.timingIfUnparsed.unit }
    }
    if (!timing) {
      timing = h && EVENT_TYPES.has(h.type)
        ? { kind: 'event', value: null, unit: null }
        : { kind: 'scheduled', value: null, unit: null }
    }

    // window: parser sobre el texto de la fila; K6 si no parsea y el modelo sí.
    const windowText = windowTextFor(table, col.index, windowRowIndexes)
    let window = parseWindow(windowText)
    if (!window && windowText.trim().length > 0 && !NO_WINDOW_RE.test(windowText.trim())) {
      if (h?.windowIfUnparsed) {
        window = {
          before: h.windowIfUnparsed.before,
          after: h.windowIfUnparsed.after,
          unit: h.windowIfUnparsed.unit,
        }
        warnings.push(`${table.key}:C${col.index}:ventana_a_revisar`)
      } else {
        warnings.push(`${table.key}:C${col.index}:ventana_no_interpretada`)
      }
    }

    const visitKey = `${table.key}-C${String(col.index).padStart(2, '0')}`
    visitKeyByCol.set(col.index, visitKey)
    visits.push({
      key: visitKey,
      tableKey: table.key,
      printedId,
      // El label de visita no está impreso por columna en F1–F5: '' es
      // ausencia documentada, no invención (el gold lo trae el generador).
      label: '',
      timing: { kind: timing.kind, value: timing.value, unit: timing.unit, anchor: null, recurrence: null },
      window,
      type: h?.type ?? 'standard',
      attributes: { fasting: null, onSite: null, armOnly: null },
      source: { page: col.page, bbox: col.headerBBox },
      confidence: 1,
    })
    if (!printedIdVerified) visits[visits.length - 1]!.confidence = 0.9
  }

  // ── Cells: marks de filas procedimiento; merged prn expandido ───────────
  const cells: Cell[] = []
  for (const cell of table.cells) {
    if (windowRowIndexes.has(cell.rowIndex)) continue
    if (!procedureRows.has(cell.rowIndex)) continue
    const procedureKey = procedureKeyByRow.get(cell.rowIndex)
    if (!procedureKey) continue

    if (cell.kind === 'mark') {
      const visitKey = visitKeyByCol.get(cell.colIndex)
      if (!visitKey) {
        warnings.push(`${table.key}:R${cell.rowIndex}:C${cell.colIndex}:col_inexistente`)
        continue
      }
      const visit = visits.find((v) => v.key === visitKey)!
      cells.push({
        visitKey,
        procedureKey,
        mark: 'x',
        noteRefs: cell.noteRefs.slice(0, 8),
        conditions: [], // commit 4: notas por celda
        procedureWindow: null, // commit 4: notas con ventana propia (T9)
        source: { page: cell.page, bbox: cell.bbox },
        confidence: cellConfidence(cell.distanceToCenter, false, checksPass, visit.printedId !== null),
        reviewed: false,
      })
      continue
    }

    if (cell.kind === 'merged') {
      // Corrida prn: «según necesidad»/«as needed» centrada en el run. Los
      // extremos del run no sobreviven al raw (sin textos vecinos que lo
      // corten): se expande a TODO el span, cubriendo la corrida entera.
      const norm = plainNorm(cell.text)
      if (norm === 'segun necesidad' || norm === 'as needed') {
        const span = cell.spanCols.length > 0 ? cell.spanCols : [cell.colIndex]
        for (const colIndex of span) {
          const visitKey = visitKeyByCol.get(colIndex)
          if (!visitKey) {
            warnings.push(`${table.key}:R${cell.rowIndex}:C${colIndex}:col_inexistente`)
            continue
          }
          const visit = visits.find((v) => v.key === visitKey)!
          cells.push({
            visitKey,
            procedureKey,
            mark: 'prn_range',
            noteRefs: [],
            conditions: [],
            procedureWindow: null,
            source: { page: cell.page, bbox: cell.bbox },
            confidence: cellConfidence(cell.distanceToCenter, true, checksPass, visit.printedId !== null),
            reviewed: false,
          })
        }
        continue
      }
      warnings.push(`${table.key}:R${cell.rowIndex}:C${cell.colIndex}:merged_sin_regla`)
    }
  }

  // Filas de atributo: hoy sin fuente de marcas en el raw (P2 las cuenta en
  // marksAttr y las descarta); cuando P2 las exponga alimentan attributes —
  // el kind del modelo ya llega clasificado por classifyRows.
  void attributeKinds

  return { visits, procedures, cells, calls: 2 }
}

/**
 * RawSchedule → Schedule (firma de la orden §2). Una pasada por tabla en
 * orden (determinista para tests); notas, reglas fuera de tabla e
 * inconsistencias llegan en el commit 4.
 */
export async function normalizeSchedule(
  raw: RawSchedule,
  deps: { llm: LlmPort; now?: () => number },
): Promise<NormalizeResult> {
  const warnings: string[] = []
  const tables: ScheduleTable[] = []
  const visits: Visit[] = []
  const procedures: Procedure[] = []
  const cells: Cell[] = []
  let calls = 0

  for (const table of raw.tables) {
    // T12: el outcome de P2 se propaga tal cual — jamás se «mejora» a
    // complete; los motivos viajan con la tabla.
    tables.push({
      key: table.key,
      // RawTable no lleva título: '' es ausencia documentada (P4 puede
      // traerlo del texto circundante).
      title: '',
      branch: null,
      phase: null,
      pages: table.pages,
      outcome: table.outcome,
      reasons: table.reasons.slice(0, 16),
    })
    const built = await assembleTable(table, deps.llm, warnings)
    visits.push(...built.visits)
    procedures.push(...built.procedures)
    cells.push(...built.cells)
    calls += built.calls
  }

  const schedule: Schedule = {
    tables,
    visits,
    procedures,
    cells,
    notes: [], // commit 4 (T8, T9)
    outOfTableRules: [], // commit 4
    inconsistencies: [], // commit 4 (T11)
  }

  // El ensamblado SIEMPRE produce dentro del contrato; si no, es bug de
  // código (no de datos): explota aquí, en la cara del desarrollador.
  const parsed = scheduleSchema.safeParse(schedule)
  if (!parsed.success) {
    throw new Error(`ensamblado violó el contrato: ${parsed.error.issues[0]?.path.join('.')}`)
  }

  return {
    schedule,
    warnings,
    // Tokens simulados: el puerto de tests no gasta; el real los reporta.
    usage: { calls, inputTokens: 0, outputTokens: 0 },
  }
}
