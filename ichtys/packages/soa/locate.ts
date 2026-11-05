/**
 * locate.ts — etapa (a): localizar las páginas del cronograma (ADR-10 §2.2 a).
 *
 * Puntaje por página con señales locales y deterministas sobre la geometría
 * (reglas de la grilla, marcas, encabezado de visitas, fila de ventana,
 * título) y negativas (índice con puntos guía, lista de tablas, sinopsis en
 * prosa). Sin modelo, sin red.
 *
 * Agrupación en tablas: los fixtures muestran que la firma de etiquetas de
 * columna NO es suficiente — F3 imprime la misma tabla en tiras de columnas
 * (V1–V10 / V11–V16 / completa), así que el corte de tabla es por RACHA de
 * páginas de grilla + SUBTÍTULO de tabla (la banda impresa bajo el título de
 * la sección: "de la rama principal", "parte B", "Pharmacokinetic grid").
 * La firma de columnas se reporta por tabla (`headerSignature`) para
 * auditoría. Sin tope de 30 páginas: locate agrupa todo lo que encuentre;
 * el tope de seguridad de 100 páginas lo marca grid con `partial`.
 *
 * El texto de la página (`headerSignature`, subtítulos) se devuelve pero
 * nunca se loguea (S8).
 */
import { findNumericHeaders, MARK_STRINGS, normalizeNumericToken, VISIT_TOKEN } from './header'
import type { HeaderSource, PageGeom, ScheduleLocation, TextItem } from './types'

/** Título de la sección del cronograma (banda de sección). */
const SECTION_RE = /(cronograma|schedule of|tabla de actividades|calendario|plan de visitas)/i

/** Señal de título (ADR-10 §2.2 a). */
const TITLE_RE =
  /(cronograma de actividades|schedule of (activities|assessments)|flow ?chart|calendario|plan de visitas|tabla de actividades|\bSoA\b)/i

/** Fila de ventana (etiqueta de la primera ficha de la banda). */
const WINDOW_RE = /^(ventana|window|margen de visita|intervalo de tolerancia|tolerance)\b/i

/**
 * Título de una página de notas dedicada (sin grilla). Las "reglas fuera de
 * la grilla" en prosa (F3 p65) son `outOfTableRules` de P3, no notas de
 * tabla: quedan fuera a propósito.
 */
const NOTES_TITLE_RE = /^(notas|comentarios|footnotes|notes|abreviaturas|abbreviations)\b/i

/** Folio impreso ("Página 21" / "Page 21") — no es título. */
const FOLIO_RE = /^(página|page)\s+\d+$/i

/** Índice: línea con puntos guía. */
const GUIDE_DOTS_RE = /(\.\s*){8,}/

const LIST_OF_TABLES_RE = /(lista de tablas|list of tables)/i
const SYNOPSIS_RE = /(sinopsis|synopsis)/i

/** Palabras que no discriminan entre subtítulos de tabla. */
const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'y', 'o', 'en',
  'the', 'of', 'for', 'and', 'or', 'cronograma', 'schedule', 'actividades',
  'activities', 'assessments', 'grid', 'tabla', 'table', 'notas', 'notes',
  'comentarios', 'comments', 'footnotes', 'parte', 'part',
])

/** Largo mínimo de un borde para contar como línea de tabla (pt). */
const MIN_SIGNAL_RULE_LENGTH = 6
/** Cantidad mínima de marcas / fichas de encabezado para aceptar una página. */
const MIN_MARKS = 3
const MIN_HEADER_TOKENS = 2
/** Columnas distintas para el ajuste fino del puntaje. */
const MIN_GRID_COLS = 4
/**
 * Densidad de una RACHA sin encabezado reconocible (P2b b): con al menos
 * estas marcas en total y MIN_GRID_COLS columnas de marcas en alguna página,
 * la racha parece un cronograma cuyo encabezado no se entiende, no ruido — se
 * conserva como tabla (la lectura la marca `failed`, visible) en vez de
 * desaparecer.
 */
const DENSE_RUN_MARKS = 12

interface Band {
  y: number
  items: TextItem[]
  tokens: string[]
  text: string
}

/** Agrupa los ítems en bandas horizontales (techo de caja, bucket de 0.5 pt), ordenadas de arriba a abajo. */
function bandsOf(items: TextItem[]): Band[] {
  const byY = new Map<number, TextItem[]>()
  for (const item of items) {
    const y = Math.round(item.bbox[3] * 2) / 2
    let arr = byY.get(y)
    if (!arr) byY.set(y, (arr = []))
    arr.push(item)
  }
  return [...byY.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, arr]) => {
      arr.sort((a, b) => a.bbox[0] - b.bbox[0])
      const tokens = arr.map((i) => i.str.trim()).filter((s) => s.length > 0)
      return { y, items: arr, tokens, text: tokens.join(' ') }
    })
}

/** Columnas distintas que ocupan las marcas: nº de clusters de centro x separados > 2 pt. */
function markColumns(items: TextItem[]): number {
  const xs = items
    .filter((i) => MARK_STRINGS.has(i.str.trim()))
    .map((i) => (i.bbox[0] + i.bbox[2]) / 2)
    .sort((a, b) => a - b)
  let cols = 0
  let prev = Number.NaN
  for (const x of xs) {
    if (Number.isNaN(prev) || x - prev > 2) cols++
    prev = x
  }
  return cols
}

interface ScoredPage {
  page: number
  score: number
  signals: Record<string, number>
  accepted: boolean
  /** Motivo de rechazo si !accepted y score > 0. */
  rejectReason: ScheduleLocation['rejected'][number]['reason'] | null
  /** De dónde salió el encabezado de la página (K2): null si no hay encabezado. */
  headerKind: HeaderSource | null
  /** Subtítulo de tabla impreso bajo el título de sección ('' si no hay). */
  subtitle: string
  /** Tokens de la banda de encabezado de visitas (orden por x). */
  headerTokens: string[]
  /** Título de página de notas dedicada (match de NOTES_TITLE_RE) si aplica. */
  notesTitle: string | null
}

/** Puntúa una página con las señales locales del ADR-10 §2.2 a. */
function scorePage(p: PageGeom): ScoredPage {
  const rulesV = p.rules.filter(
    (r) => Math.abs(r.x1 - r.x0) < 0.5 && r.y1 - r.y0 >= MIN_SIGNAL_RULE_LENGTH,
  ).length
  const rulesH = p.rules.filter(
    (r) => Math.abs(r.y1 - r.y0) < 0.5 && r.x1 - r.x0 >= MIN_SIGNAL_RULE_LENGTH,
  ).length
  const marks = p.items.filter((i) => MARK_STRINGS.has(i.str.trim())).length
  const bands = bandsOf(p.items)
  const contentBands = bands.filter((b) => !FOLIO_RE.test(b.tokens[0] ?? ''))

  // Mejor banda de encabezado de visitas (la que más fichas de visita tiene).
  let headerBand: Band | null = null
  let headerCount = 0
  for (const band of bands) {
    const n = band.tokens.filter((t) => VISIT_TOKEN.test(t)).length
    if (n > headerCount) {
      headerCount = n
      headerBand = band
    }
  }
  // Plan B (P2b): encabezado numérico etiquetado (mismo detector que grid).
  // K2: se registra de qué tipo salió (visita vs. eje temporal).
  // P2c: TODAS las tiras de la página suman — cada una con su etiqueta y sus
  // fichas (partidas o no, compuestas en `chips`) — para que la firma de la
  // tabla vea la tabla completa y no solo la primera tira.
  let numericTokens: string[] | null = null
  let headerKind: HeaderSource | null = headerCount >= MIN_HEADER_TOKENS ? 'prefixed' : null
  if (headerCount < MIN_HEADER_TOKENS) {
    const strips = findNumericHeaders(p.items)
    if (strips.length > 0) {
      headerCount = strips.reduce((acc, s) => acc + s.integers.length, 0)
      // La firma lleva las fichas NORMALIZADAS: cualquier guion impreso
      // ("-", "–") es la misma «columna sin número» (—).
      numericTokens = strips.flatMap((s) => s.chips.map(normalizeNumericToken))
      headerKind = strips.some((s) => s.kind === 'visit') ? 'numeric_visit' : 'numeric_time'
    }
  }

  const windowRow = bands.some((b) => WINDOW_RE.test(b.tokens[0] ?? '') || WINDOW_RE.test(b.text))
    ? 1
    : 0
  const title = contentBands.slice(0, 4).some((b) => TITLE_RE.test(b.text)) ? 1 : 0
  const tocDots = bands.filter((b) => GUIDE_DOTS_RE.test(b.text)).length
  const listTables = contentBands.slice(0, 3).some((b) => LIST_OF_TABLES_RE.test(b.text)) ? 1 : 0
  const synopsis = contentBands.slice(0, 3).some((b) => SYNOPSIS_RE.test(b.text)) ? 1 : 0
  const gridCols = markColumns(p.items)

  const landscape = p.width > p.height || p.rotate === 90 || p.rotate === 270 ? 1 : 0
  const structure = rulesV >= 2 && rulesH >= 2 ? 4 : 0

  const score =
    structure +
    (marks >= MIN_MARKS ? 2 : 0) +
    (headerCount >= MIN_HEADER_TOKENS ? 2 : 0) +
    windowRow +
    landscape +
    title +
    (gridCols >= MIN_GRID_COLS ? 1 : 0)

  // Aceptación: estructura de grilla real (bordes H y V) y contenido de
  // cronograma, sin negativas de índice / lista / sinopsis.
  const accepted =
    structure === 4 &&
    (marks >= MIN_MARKS || headerCount >= MIN_HEADER_TOKENS) &&
    tocDots === 0 &&
    listTables === 0 &&
    synopsis === 0

  let rejectReason: ScoredPage['rejectReason'] = null
  if (!accepted && score > 0) {
    rejectReason = tocDots > 0 ? 'toc' : listTables ? 'list_of_tables' : synopsis ? 'synopsis_prose' : 'low_density'
  }

  // Subtítulo de tabla: banda inmediatamente inferior al título de sección.
  let subtitle = ''
  for (let i = 0; i < contentBands.length - 1; i++) {
    if (SECTION_RE.test(contentBands[i]!.text)) {
      subtitle = contentBands[i + 1]!.text.trim().toLowerCase()
      break
    }
  }

  // Título de página de notas (banda superior sin contar el folio).
  const firstContent = contentBands[0]?.text ?? ''
  const notesTitle = NOTES_TITLE_RE.test(firstContent) && rulesV + rulesH === 0 ? firstContent : null

  return {
    page: p.page,
    score,
    signals: { landscape, rulesV, rulesH, marks, gridCols, headerTokens: headerCount, windowRow, title, tocDots, listTables, synopsis },
    accepted,
    rejectReason,
    headerKind,
    subtitle,
    headerTokens: numericTokens ?? (headerBand ? [...headerBand.tokens] : []),
    notesTitle,
  }
}

/** Palabras clave de un título de tabla/nota, para emparejar notas con su tabla. */
function keywordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-záéíóúüñ0-9]+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
  )
}

interface TableAcc {
  key: string
  pages: number[]
  /** Evidencia de la racha (P2b b): marcas totales, páginas con encabezado, máx. columnas de marcas. */
  marks: number
  headerPages: number
  /** Tipos de encabezado vistos en la racha (K2), para la firma de la tabla. */
  headerKinds: Set<HeaderSource>
  maxGridCols: number
  notePages: number[]
  subtitle: string
  subtitleKeywords: Set<string>
  headerSignature: string[]
}

/**
 * Asigna una TANDA de páginas de notas (consecutivas: "Comentarios 1/2/3" de
 * F3 es una sola tanda) a la tabla que mejor la nombra: máximo de palabras
 * clave compartidas con el subtítulo; a igualdad, la tabla cuya última página
 * antes de la tanda sea la más cercana. Sin ninguna coincidencia, la primera
 * tabla que todavía no tiene notas (F3/F4/F5: "Comentarios 1", "Notas",
 * "Footnotes" siguen a toda la grilla y el gold las da a T1).
 */
function assignNoteBatch(notes: ScoredPage[], tables: TableAcc[]): void {
  const noteKeywords = new Set<string>()
  let batchStart = Infinity
  for (const note of notes) {
    for (const word of keywordsOf(note.notesTitle ?? '')) noteKeywords.add(word)
    batchStart = Math.min(batchStart, note.page)
  }
  let best: TableAcc | null = null
  let bestShared = 0
  let bestNear = -1
  for (const table of tables) {
    let shared = 0
    for (const word of table.subtitleKeywords) if (noteKeywords.has(word)) shared++
    if (shared === 0) continue
    const near = Math.max(...table.pages.filter((p) => p < batchStart), -1)
    if (shared > bestShared || (shared === bestShared && near > bestNear)) {
      best = table
      bestShared = shared
      bestNear = near
    }
  }
  if (best === null) {
    best = tables.find((t) => t.notePages.length === 0) ?? tables[tables.length - 1] ?? null
  }
  for (const note of notes) best?.notePages.push(note.page)
}

/**
 * Etapa (a): localiza las páginas del cronograma y las agrupa en tablas.
 * Determinista y puro: misma entrada, misma salida; sin logs (S8).
 */
export function locateSchedule(pages: PageGeom[]): ScheduleLocation {
  const scored = pages.map(scorePage)

  const candidates = scored
    .filter((s) => s.score > 0)
    .map((s) => ({ page: s.page, score: s.score, signals: s.signals }))
  const rejected = scored
    .filter((s) => !s.accepted && s.rejectReason !== null)
    .map((s) => ({ page: s.page, reason: s.rejectReason! }))

  // Agrupación: racha de páginas de grilla consecutivas con el mismo subtítulo.
  const tables: TableAcc[] = []
  let previousAccepted = -1
  for (const s of scored) {
    if (!s.accepted) continue
    const current = tables[tables.length - 1]
    const continues =
      current !== undefined && s.page === previousAccepted + 1 && s.subtitle === current.subtitle
    if (!continues) {
      tables.push({
        key: `T${tables.length + 1}`,
        pages: [],
        marks: 0,
        headerPages: 0,
        headerKinds: new Set(),
        maxGridCols: 0,
        notePages: [],
        subtitle: s.subtitle,
        subtitleKeywords: keywordsOf(s.subtitle),
        headerSignature: [],
      })
    }
    const table = tables[tables.length - 1]!
    table.pages.push(s.page)
    table.marks += s.signals.marks ?? 0
    table.maxGridCols = Math.max(table.maxGridCols, s.signals.gridCols ?? 0)
    if ((s.signals.headerTokens ?? 0) >= MIN_HEADER_TOKENS) {
      table.headerPages++
      if (s.headerKind !== null) table.headerKinds.add(s.headerKind)
    }
    // Firma de encabezado: unión en orden de primera aparición (auditoría;
    // en F3 las tiras de columnas de una misma tabla se suman acá).
    for (const token of s.headerTokens) {
      if (!table.headerSignature.includes(token)) table.headerSignature.push(token)
    }
    previousAccepted = s.page
  }

  // Precisión (P2b b) + K1 (G12): una racha sin NINGÚN encabezado (con
  // prefijo o numérico) y sin densidad de marcas es ruido — una tabla con
  // bordes y alguna «X» que no es cronograma. Se descarta con razón
  // EXPLÍCITA en `rejected`, nunca en silencio. Una racha CON encabezado
  // NUNCA se descarta (K1): las marcas se reconocen con un conjunto fijo de
  // glifos y un cronograma real marcado con otro símbolo queda con
  // encabezado y 0 marcas reconocidas — tirarlo sería la pérdida silenciosa
  // que P2 cierra. Se conserva y la lectura la baja a 'failed' con 'no_marks'
  // (la tabla de abreviaturas con fichas V1… queda igual: ruido honesto,
  // visible). Una racha DENSA sin encabezado reconocible tampoco se
  // descarta: es una tabla real ilegible y tiene que salir `failed`, no
  // desaparecer.
  const kept: TableAcc[] = []
  for (const table of tables) {
    const hasHeader = table.headerPages > 0
    const dense = table.marks >= DENSE_RUN_MARKS && table.maxGridCols >= MIN_GRID_COLS
    if (hasHeader || dense) {
      kept.push(table)
      continue
    }
    for (const page of table.pages) rejected.push({ page, reason: 'no_header' })
  }
  // Claves contiguas tras el descarte.
  tables.length = 0
  for (const [i, table] of kept.entries()) {
    table.key = `T${i + 1}`
    tables.push(table)
  }

  // Páginas de notas dedicadas (sin grilla) → su tabla, en tandas
  // consecutivas. Solo las posteriores a la primera página de grilla: las
  // "Abreviaturas" del frente del documento (F3 p5) no son notas de ninguna
  // tabla.
  const firstGridPage = tables[0]?.pages[0] ?? Infinity
  const notePages = scored.filter(
    (s) => s.notesTitle !== null && !s.accepted && s.page > firstGridPage,
  )
  for (let i = 0; i < notePages.length; i++) {
    const batch = [notePages[i]!]
    while (
      i + 1 < notePages.length &&
      notePages[i + 1]!.page === batch[batch.length - 1]!.page + 1
    ) {
      batch.push(notePages[++i]!)
    }
    assignNoteBatch(batch, tables)
  }

  rejected.sort((a, b) => a.page - b.page)

  // Firma de la tabla (K2): cualquier encabezado de VISITA gana (prefijo o
  // numérico); 'numeric_time' solo si ninguna página de la racha tuvo
  // encabezado de visita — es el caso que P3 debe tratar como tiempo.
  const headerKindOf = (t: TableAcc): ScheduleLocation['tables'][number]['headerKind'] =>
    t.headerKinds.has('numeric_visit') ? 'numeric_visit'
    : t.headerKinds.has('prefixed') ? 'prefixed'
    : t.headerKinds.has('numeric_time') ? 'numeric_time'
    : 'none'

  return {
    candidates,
    tables: tables.map((t) => ({
      key: t.key,
      pages: t.pages,
      notePages: t.notePages.sort((a, b) => a - b),
      headerSignature: t.headerSignature,
      headerKind: headerKindOf(t),
    })),
    rejected,
  }
}
