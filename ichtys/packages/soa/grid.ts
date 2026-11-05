/**
 * grid.ts — etapa (b): leer la grilla cruda por tabla (ADR-10 §2.2 b).
 *
 * Todo por página y en el espacio de usuario SIN rotar (igual que el gold):
 * cada página de grilla trae sus propias fronteras de celda, así que
 * columnas, filas y celdas se leen con la geometría LOCAL de la página. Sin
 * modelo, sin red, sin logs (S8).
 *
 * P2c C1b — REGIONES: el encabezado puede venir en TIRAS apiladas por
 * página (protocolo de 46 columnas); cada tira es una región con su franja
 * vertical y el cuerpo de lectura corre por región: las filas cuelgan de SU
 * tira y las marcas van a las columnas de ESA tira (las tiras comparten la
 * grilla x; sin regiones, las marcas de la tira de abajo se asignarían a
 * las columnas de la de arriba).
 *
 * Columnas de la tabla: una banda-x por ficha de encabezado vista POR
 * PRIMERA VEZ — F3 imprime una misma tabla en tiras de columnas re-escaladas
 * (V1–V10 anchas en p13, V11–V16 en p14, la tabla completa en p15+), así que
 * la identidad de columna es la FICHA del encabezado, no la banda-x: una
 * página cuyas fichas ya se vieron (el encabezado repetido de F1) no aporta
 * columnas. Las fichas REPETIDAS de una misma página (los tres "—" de la
 * tira de F3 p14) son columnas distintas: la novedad se mide contra lo visto
 * al empezar la página. `RawColumn` conserva la página y la banda-x del
 * primer aparecimiento, como el gold.
 *
 * Filas: por bordes horizontales cuando la página los traza por celda (el
 * gold es exactamente el intervalo entre bordes), o por BANDAS DE LÍNEA BASE
 * cuando no (F2 T1/T3 son "bordered=false": la fila de ventana es lo único
 * con caja). Las bandas por encima de la fila de ventana (o del encabezado
 * de fichas) son el encabezado repetido, no filas. Las filas de ATRIBUTO
 * ("Ayuno", "visit type"…) se entregan marcadas (`isAttributeCandidate`) pero
 * sus marcas no son celdas del cronograma — la clasificación fina es P3.
 * Una fila que arranca sin etiqueta propia tras el corte de página lleva
 * `continuedFromPrevPage` (F3 p14 continúa la fila partida de p13).
 *
 * Marcas: la ficha 'X' (y hermanas) cae en la columna por centro-x y en la
 * fila por la BASE de su caja — en las columnas sombreadas el generador
 * escribe la marca pegada al TECHO de la fila (otra operación de texto) y la
 * base sigue cayendo dentro de la fila correcta.
 *
 * `checks` (G1–G5 geométricos; G6 llamadas de nota con texto; G7 texto
 * pequeño no consumido) bajan la tabla a 'partial' con
 * 'validation_failed:<id>' cuando fallan.
 */
import {
  countByRole,
  findNumericHeader,
  findNumericHeaders,
  LABEL_WINDOW,
  MARK_STRINGS,
  normalizeNumericToken,
  TIME_TOKEN,
} from './header'
import type {
  BBox,
  HeaderSource,
  PageGeom,
  RawCell,
  RawColumn,
  RawRow,
  RawSchedule,
  RawTable,
  ScheduleLocation,
  TextItem,
} from './types'

/** Fila de ventana (etiqueta de la banda). */
const WINDOW_ROW_RE =
  /^(ventana|window|margen de visita|intervalo de tolerancia|visit window|tolerance)\b/i

/** Léxico de fila de atributo (ADR-10 §2.2 b: la clasificación fina es P3). */
const ATTRIBUTE_RE =
  /(ayuno|fasting|visita a la clínica|on ?site|presencial|tipo de visita|visit type|^tipo\b)/i

/** Tolerancia de agrupado de fronteras (pt). */
const EDGE_EPSILON = 1
/** Tamaño mínimo de una frontera para contar (pt). */
const MIN_EDGE_LENGTH = 6
/** Fuente por debajo de la cual una ficha es superíndice de nota, no marca. */
const MIN_MARK_FONT = 5
/** Separación entre líneas base que corta un cluster de filas (pt). */
const ROW_CLUSTER_GAP = 10

/** Texto de celda de rango ("según necesidad" y variantes). */
const PRN_RE = /(según necesidad|as needed|a demanda|si aplica|p\.?r\.?n\.?)/

/** Llamada de nota: número corto, letra o marca tipográfica. */
const NOTE_REF_RE = /^(\d{1,2}|[a-z]|†|‡|§)$/

/**
 * Línea de nota: "ref␣texto" en una sola operación de texto (pdfjs colapsa
 * los dos espacios del dibujo a uno). La fuente de las líneas de nota es ~9
 * (el título de la página de notas es 12; el folio y el encabezado, 7–8).
 */
const NOTE_LINE_RE = /^(\d{1,2}|[†‡§]|[a-z])\s+(\S.*)$/
const NOTE_FONT_MIN = 8
const NOTE_FONT_MAX = 10

/** Tope de seguridad de páginas por tabla (§3: sin tope de 30; 100 → partial). */
const PAGE_LIMIT = 100

/** Folio impreso ("Página 11 de 50") — texto de página, no de celda. */
const FOLIO_TEXT_RE = /^(página|page)\b/i

/**
 * Banda de días ("Día", "Study day"…): fila estructural del SoA como la
 * ventana y los atributos — lleva el eje temporal (D-1, D0…) sobre la
 * grilla, no celdas del cronograma. Se entrega como fila cruda; P3 decide.
 */
const DAY_ROW_RE = /^(día|dia|day|días|dias|days|study day|semana|week)\b/i

/** Ficha de día de la banda estructural ("D-1", "D 0", "D+14"): no es contenido de celda. */
const DAY_TOKEN_RE = /^D\s*[-+]?\d{1,3}$/i

/**
 * Tope de fuente de "texto pequeño" para G7: por debajo de esto un ítem en
 * zona de grilla que no cayó en ninguna celda es contenido perdido en
 * silencio (notas dibujadas al costado, marcas diminutas).
 */
const TINY_FONT_MAX = 6

/** Separación entre ítems de texto que siguen siendo UN grupo (pt). */
const TEXT_GROUP_GAP = 6

interface TextGroup {
  x0: number
  x1: number
  text: string
}

/** Agrupa ítems de texto por adyacencia x (los tokens partidos vuelven a ser
 * un texto; los partidos en DOS LÍNEAS se recomponen de abajo hacia arriba). */
function groupTexts(items: TextItem[]): TextGroup[] {
  const sorted = [...items].sort(
    (a, b) => a.bbox[0] - b.bbox[0] || b.bbox[1] - a.bbox[1],
  )
  const groups: TextGroup[] = []
  for (const item of sorted) {
    const last = groups[groups.length - 1]
    if (last && item.bbox[0] - last.x1 <= TEXT_GROUP_GAP) {
      last.x1 = Math.max(last.x1, item.bbox[2])
      last.text += ` ${item.str.trim()}`
    } else {
      groups.push({ x0: item.bbox[0], x1: item.bbox[2], text: item.str.trim() })
    }
  }
  return groups.filter((g) => g.text.length > 0)
}

/** Texto comparable de ficha: sin espacios (los tokens partidos ya se recomponen). */
function normalizeText(text: string): string {
  return normalizeNumericToken(text)
}

interface ItemBand {
  y: number
  items: TextItem[]
}

/** Bandas de texto por techo de caja (bucket 0.5 pt), arriba primero. */
function textBands(items: TextItem[]): ItemBand[] {
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
      return { y, items: arr }
    })
}

/** Fronteras dedup (agrupa a EDGE_EPSILON y promedia). */
function clusterEdges(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const edges: number[] = []
  let acc: number[] = []
  for (const value of sorted) {
    const prev = acc[acc.length - 1]
    if (prev !== undefined && value - prev <= EDGE_EPSILON) {
      acc.push(value)
    } else {
      if (acc.length > 0) edges.push(acc.reduce((a, b) => a + b, 0) / acc.length)
      acc = [value]
    }
  }
  if (acc.length > 0) edges.push(acc.reduce((a, b) => a + b, 0) / acc.length)
  return edges
}

function center(item: TextItem): number {
  return (item.bbox[0] + item.bbox[2]) / 2
}

/**
 * Intervalos de celda de una banda-y: los bordes V que CRUZAN la banda como
 * cortes; el intervalo entre cortes consecutivos es una celda de ESA fila.
 * En las filas de datos los bordes van por celda y los intervalos son las
 * columnas; en la fila de ventana cada grupo se dibuja como UNA caja que
 * ocupa solo esa banda, así que los intervalos son los GRUPOS.
 */
function rowIntervals(page: PageGeom, y0: number, y1: number): Array<[number, number]> {
  const xs = clusterEdges(
    page.rules
      .filter(
        (r) =>
          Math.abs(r.x1 - r.x0) < 0.5 &&
          r.y1 - r.y0 >= MIN_EDGE_LENGTH &&
          r.y1 > y0 &&
          r.y0 < y1,
      )
      .flatMap((r) => [r.x0, r.x1]),
  )
  const intervals: Array<[number, number]> = []
  for (let i = 0; i + 1 < xs.length; i++) intervals.push([xs[i]!, xs[i + 1]!])
  return intervals
}

/** Caja que envuelve a un grupo de ítems. */
function boxOf(items: TextItem[]): [number, number, number, number] | null {
  if (items.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const item of items) {
    x0 = Math.min(x0, item.bbox[0])
    y0 = Math.min(y0, item.bbox[1])
    x1 = Math.max(x1, item.bbox[2])
    y1 = Math.max(y1, item.bbox[3])
  }
  return [x0, y0, x1, y1]
}

/** Una fila candidata: banda-y + ítems de etiqueta y marcas. */
interface RowBand {
  y0: number
  y1: number
  labelItems: TextItem[]
  marks: TextItem[]
  /** Fila de atributo (ADR-10 §2.2 b): sus marcas no son celdas. */
  isAttribute: boolean
}

/** Lee una tabla: columnas registradas por ficha nueva + filas y celdas por página. */
function readTable(
  located: ScheduleLocation['tables'][number],
  byPage: Map<number, PageGeom>,
  lastDocPage: number,
): RawTable {
  const columns: RawColumn[] = []
  const columnTokens: Array<Set<string>> = []
  const seenTokens = new Set<string>()
  const rows: RawRow[] = []
  const cells: RawCell[] = []
  const notes: RawTable['notes'] = []
  let windowRow: { rowIndex: number; cells: RawCell[] } | null = null
  let lastRowIndex = -1
  // Estado para los chequeos §4: filas de ventana (todas, una por página) y
  // contadores de marcas por página (G3), cobertura de ventana (G2).
  const windowRowIndexes = new Set<number>()
  /** Por qué una marca presente no llegó a ser celda (P2b c): solo códigos y conteos (S8). */
  interface LostMarks {
    sinColumna: number
    bandaSinFicha: number
    sinFila: number
  }
  const markStats: Array<{
    page: number
    present: number
    attr: number
    assigned: number
    lost: LostMarks
  }> = []
  /** Rango-x de las columnas con ficha de cada página (G4 distingue texto dentro y fuera). */
  const columnSpanByPage = new Map<number, [number, number]>()
  const windowCoverage: Array<{ page: number; covered: number; local: number; hasText: boolean }> = []
  // G1 por página (ADR-10 §d-1): columnas de tabla con ficha de encabezado
  // en cada página, para exigirles contenido en ESA página.
  const headerColsByPage = new Map<number, Set<number>>()
  const firstColByPage = new Map<number, number>()
  const windowBandByPage = new Map<number, [number, number]>()
  // Estado para G6/G7 (K1, R2): texto pequeño no consumido y texto rotado
  // por página de grilla; bandas de fila de atributo (estructura, no celdas).
  const tinyUnconsumed: Array<{ page: number; count: number }> = []
  const rotatedByPage = new Map<number, number>()
  const attrBandsByPage = new Map<number, Array<[number, number]>>()

  // Las páginas de notas dedicadas no son de grilla (locate las aparta):
  // entran al loop solo para extraer sus notas.
  const pageNumbers = [...located.pages]
  for (const pn of located.notePages) if (!pageNumbers.includes(pn)) pageNumbers.push(pn)
  // R7: una página localizada que NO está en el input es un documento con
  // huecos — la tabla no se puede leer completa, así que la tabla sale
  // 'failed' con 'grid_unreadable' en vez de saltar la página en silencio.
  const missingPages = pageNumbers.filter((pn) => !byPage.has(pn))
  for (const pageNumber of pageNumbers) {
    const srcPage = byPage.get(pageNumber)
    if (!srcPage) continue

    // --- Notas de página dedicada: cada nota es UNA operación de texto
    // "ref␣texto"; la continuación del spill ("Continúa la nota anterior: …")
    // no lleva ref y queda fuera. El texto se devuelve pero nunca se loguea
    // (S8).
    if (located.notePages.includes(pageNumber)) {
      for (const item of srcPage.items) {
        const match = item.str.trim().match(NOTE_LINE_RE)
        if (!match || item.fontSize < NOTE_FONT_MIN || item.fontSize > NOTE_FONT_MAX) continue
        notes.push({
          ref: match[1]!,
          page: pageNumber,
          text: match[2]!.trim(),
          bbox: item.bbox,
        })
      }
      continue
    }

    // --- Regiones de grilla de la página (P2c C1b): el encabezado puede
    // venir en TIRAS apiladas (protocolo de 46 columnas: fichas de visita
    // en dos franjas por página, ficha partida prefijo/número). Cada tira
    // es una REGIÓN con su franja vertical: sus filas cuelgan de ELLA y sus
    // marcas van a SUS columnas — las tiras comparten la grilla x, así que
    // sin regiones las marcas de la tira de abajo caerían en las columnas
    // de la de arriba (sobre-asignación). Con fichas con prefijo (≥ 2 en
    // una banda) o sin tiras reconocibles, la región es la página entera
    // (comportamiento previo a P2c).
    let prefixedBandHits = 0
    {
      // G18 §3.2: el camino con prefijo se activa por fichas de ID; el tiempo
      // solo cuando no hay ids en ninguna banda (F5 replica R3).
      let bestIds = 0
      let bestTimes = 0
      for (const band of textBands(srcPage.items)) {
        const { ids, times } = countByRole(band.items.map((i) => i.str.trim()))
        if (ids > bestIds) bestIds = ids
        if (times > bestTimes) bestTimes = times
      }
      prefixedBandHits = bestIds > 0 ? bestIds : bestTimes
    }
    const regions: Array<{ yTop: number; yBottom: number }> = []
    if (prefixedBandHits >= 2) {
      regions.push({ yTop: Infinity, yBottom: -Infinity })
    } else {
      const strips = findNumericHeaders(srcPage.items)
      if (strips.length === 0) {
        regions.push({ yTop: Infinity, yBottom: -Infinity })
      } else {
        for (const [k, strip] of strips.entries()) {
          // G18 §1: el techo de la región cubre TODO el bloque del encabezado
          // de la tira — fichas, letras y su ETIQUETA de fila, que en el
          // protocolo difícil vive ~11 pt POR ENCIMA de las fichas. Con el
          // techo en las fichas la etiqueta quedaba fuera de la franja y
          // findNumericHeader, que exige etiqueta, no veía encabezado DENTRO
          // de la región: 0 columnas (regresión de C1b, medida G18). La
          // PRIMERA región sube hasta el techo de la página: encima del
          // primer encabezado viven los períodos y la propia etiqueta.
          // (La etiqueta elevada de una tira INTERIOR cae además en la franja
          // de la región anterior: el rediseño por bloque de G18 §4 lo
          // resuelve; ningún fixture actual lo ejercita.)
          const labelTop = strip.labelItems.reduce((top, l) => Math.max(top, l.bbox[3]), -Infinity)
          const yTop = k === 0 ? Infinity : Math.max(strip.yTop, labelTop) + LABEL_WINDOW
          // La franja de una tira llega hasta el techo de la siguiente; la
          // última, hasta el fondo de la página.
          regions.push({ yTop, yBottom: strips[k + 1]?.yTop ?? -Infinity })
        }
      }
    }

    // Acumuladores POR PÁGINA (G1/G3/G4/G7 leen por página, no por región).
    let marksPresent = 0
    let marksAttr = 0
    let marksAssigned = 0
    const lost: LostMarks = { sinColumna: 0, bandaSinFicha: 0, sinFila: 0 }
    const pageHeaderCols = new Set<number>()
    let pageFirstColX = Infinity
    let pageSpan: [number, number] | null = null
    const pageAttrBands: Array<[number, number]> = []
    let pageWindowBand: [number, number] | null = null
    let lastBottom = Infinity

    for (const [regionIdx, region] of regions.entries()) {
      // Sub-página: los ítems con el centro de su caja en la franja de la
      // tira y las reglas que la cruzan. El cuerpo de lectura no distingue
      // región de página: encuentra su encabezado, filas y celdas dentro
      // de la franja.
      const page: PageGeom = {
        ...srcPage,
        items: srcPage.items.filter((i) => {
          const cy = (i.bbox[1] + i.bbox[3]) / 2
          return cy > region.yBottom && cy <= region.yTop
        }),
        rules: srcPage.rules.filter((r) => {
          const rTop = Math.max(r.y0, r.y1)
          const rBottom = Math.min(r.y0, r.y1)
          return rTop > region.yBottom && rBottom < region.yTop
        }),
      }

    // --- Fronteras de celda de la página.
    const vxs = clusterEdges(
      page.rules
        .filter((r) => Math.abs(r.x1 - r.x0) < 0.5 && r.y1 - r.y0 >= MIN_EDGE_LENGTH)
        .flatMap((r) => [r.x0, r.x1]),
    )
    const hys = clusterEdges(
      page.rules
        .filter((r) => Math.abs(r.y1 - r.y0) < 0.5 && r.x1 - r.x0 >= MIN_EDGE_LENGTH)
        .flatMap((r) => [r.y0, r.y1]),
    )
    const bandsX: Array<[number, number]> = []
    for (let i = 0; i + 1 < vxs.length; i++) bandsX.push([vxs[i]!, vxs[i + 1]!])

    // --- Encabezado: bandas de texto con más fichas de visita, MÁS las
    // pegadas (±8 pt): una ficha partida por el extractor ("V" / "12" en dos
    // líneas) cae en dos bandas por el techo de sus cajas. Los ítems se
    // recomponen por adyacencia x (groupTexts), así la ficha vuelve a ser un
    // solo texto.
    const bands = textBands(page.items)
    let headerY = 0
    let headerHits = 0
    {
      // G18 §3.2: la banda de encabezado es la de más IDS de visita; la de
      // tiempo (S…, W…, D…) solo cuando ninguna banda tiene ids — en el
      // protocolo de 46 columnas la fila de semanas (17–21 fichas) le ganaba
      // a la de ids partida en varias líneas y las columnas salían del
      // TIEMPO, no de las visitas.
      let bestIdY = 0
      let bestIdHits = 0
      let bestTimeY = 0
      let bestTimeHits = 0
      for (const band of bands) {
        const { ids, times } = countByRole(band.items.map((i) => i.str.trim()))
        if (ids > bestIdHits) {
          bestIdHits = ids
          bestIdY = band.y
        }
        if (times > bestTimeHits) {
          bestTimeHits = times
          bestTimeY = band.y
        }
      }
      if (bestIdHits > 0) {
        headerHits = bestIdHits
        headerY = bestIdY
      } else if (bestTimeHits > 0) {
        headerHits = bestTimeHits
        headerY = bestTimeY
      }
    }
    // Plan B (P2b): sin al menos 2 fichas con prefijo, el encabezado puede ser
    // la fila ETIQUETADA de enteros ("Número de visita" 1, 2, 3 … con guiones
    // como columnas sin número). Las fichas van una por una — nunca por
    // groupTexts, que uniría "1" y "-" en columnas angostas — y la etiqueta
    // queda fuera: no es una columna.
    // K2: las columnas registradas en ESTA página dicen de dónde salió su
    // encabezado, para que P3 nunca tome un día por un número de visita.
    // P2c C1b: la ficha se registra COMPUESTA (chips): con la ficha partida
    // en dos filas, el prefijo de arriba + el número de abajo son UNA ficha
    // ('V1'), no una columna sin identidad.
    const numericHeader = headerHits < 2 ? findNumericHeader(page.items) : null
    if (numericHeader) headerY = numericHeader.y
    const pageHeaderSource: HeaderSource = numericHeader
      ? numericHeader.kind === 'visit' ? 'numeric_visit' : 'numeric_time'
      : 'prefixed'
    const headerGroups = numericHeader
      ? numericHeader.tokens.map((t, i) => ({
          x0: t.bbox[0],
          x1: t.bbox[2],
          text: numericHeader.chips[i] ?? t.str.trim(),
        }))
      : groupTexts(
          bands
            .filter((b) => Math.abs(b.y - headerY) <= 8)
            .flatMap((b) => b.items)
            .filter((i) => i.str.trim().length > 0 && i.fontSize >= 4),
        )

    // --- Bandas de columna efectivas: los bordes V no siempre llegan por
    // columna (F1 T2 y F5 T1 dejan zonas sin bordes intermedios), así que una
    // banda-x que contiene varias fichas del encabezado se SUBDIVIDE por
    // ficha: los cortes son los puntos medios entre fichas adyacentes.
    const effBands: Array<[number, number]> = []
    const effTokens: TextGroup[][] = []
    for (const band of bandsX) {
      const tokens = headerGroups.filter((g) => {
        const cx = (g.x0 + g.x1) / 2
        return cx >= band[0] && cx <= band[1]
      })
      if (tokens.length <= 1) {
        effBands.push(band)
        effTokens.push(tokens)
        continue
      }
      for (let k = 0; k < tokens.length; k++) {
        const cx = (tokens[k]!.x0 + tokens[k]!.x1) / 2
        const left = k === 0 ? band[0] : ((tokens[k - 1]!.x0 + tokens[k - 1]!.x1) / 2 + cx) / 2
        const right = k === tokens.length - 1 ? band[1] : (cx + (tokens[k + 1]!.x0 + tokens[k + 1]!.x1) / 2) / 2
        effBands.push([left, right])
        effTokens.push([tokens[k]!])
      }
    }

    // --- Columnas nuevas: bandas con ficha de encabezado nueva. La novedad
    // se mide contra lo visto AL EMPEZAR la página: las 3 columnas "—" de la
    // tira de F3 p14 comparten texto con la primera, pero el texto es nuevo
    // en ESA página y las tres son columnas; el encabezado completo repetido
    // de una página de continuación (todas vistas) no aporta nada.
    const tokensBeforePage = new Set(seenTokens)
    const localColumns: Array<{ band: [number, number]; token: string | null }> = []
    for (let i = 0; i < effBands.length; i++) {
      const band = effBands[i]!
      const tokens = effTokens[i]!
      if (tokens.length === 0) continue
      const norm = tokens.map((t) => normalizeText(t.text))
      localColumns.push({ band, token: norm[0]! })
      if (norm.some((t) => !tokensBeforePage.has(t))) {
        // Caja de la fila del encabezado: el texto se apoya a 6 pt del fondo
        // de una fila de 20 pt (convención del generador).
        const box: BBox = [
          Math.min(...tokens.map((t) => t.x0)),
          headerY - 14,
          Math.max(...tokens.map((t) => t.x1)),
          headerY + 6,
        ]
        for (const t of norm) seenTokens.add(t)
        columns.push({
          index: columns.length,
          page: pageNumber,
          xCenter: (band[0] + band[1]) / 2,
          x0: band[0],
          x1: band[1],
          headerText: tokens.map((t) => t.text).join(' '),
          headerBBox: box,
          headerSource: pageHeaderSource,
          empty: false,
          timingText: '',
        })
        columnTokens.push(new Set(norm))
      }
    }

    // --- G18 §3.2: proyección de la fila de TIEMPO (camino con prefijo).
    // La fila de tiempo bajo la línea de ids no define columnas (arriba): se
    // proyecta por x sobre las columnas de ESTA página como `timing`. La
    // franja válida va de la ventana pegada del encabezado (−8 pt) al techo
    // de la PRIMERA marca: entre ambos vive el resto del bloque de
    // encabezado; una fila de tiempo más abajo (bajo marcas) pertenece a
    // otra tabla apilada y no se proyecta (el discriminador de G18 §4). El
    // camino numérico (fila etiquetada «semanas…» con enteros) se proyecta
    // con el bloque multilínea de §3.3.
    if (!numericHeader && localColumns.length > 0) {
      const firstMarkTop = Math.min(
        ...page.items
          .filter((i) => MARK_STRINGS.has(i.str.trim()) && i.fontSize >= MIN_MARK_FONT)
          .map((i) => i.bbox[3]),
      )
      const timeItems = page.items
        .filter(
          (i) =>
            TIME_TOKEN.test(i.str.trim()) &&
            i.fontSize >= 4 &&
            !i.rotated &&
            i.bbox[3] <= headerY - 8 &&
            i.bbox[1] >= firstMarkTop,
        )
        .sort((a, b) => a.bbox[0] - b.bbox[0])
      if (timeItems.length > 0) {
        for (const lc of localColumns) {
          const idx = columnTokens.findIndex((s) => lc.token !== null && s.has(lc.token))
          // Solo llena la primera vez: el encabezado repetido de una página
          // de continuación proyecta lo mismo; no sobrescribe.
          if (idx < 0 || columns[idx]!.timingText !== '') continue
          const chips = timeItems.filter((i) => i.bbox[0] < lc.band[1] && i.bbox[2] > lc.band[0])
          if (chips.length > 0) columns[idx]!.timingText = chips.map((c) => c.str.trim()).join(' ')
        }
      }
    }

    // Zona de etiquetas: a la izquierda de la primera banda-x con ficha.
    const firstColumnX = localColumns[0]?.band[0] ?? Infinity
    pageFirstColX = Math.min(pageFirstColX, firstColumnX)
    if (localColumns.length > 0) {
      const span: [number, number] = [
        Math.min(...localColumns.map((lc) => lc.band[0])),
        Math.max(...localColumns.map((lc) => lc.band[1])),
      ]
      pageSpan = pageSpan
        ? [Math.min(pageSpan[0], span[0]), Math.max(pageSpan[1], span[1])]
        : span
    }
    const marks = page.items.filter(
      (i) => MARK_STRINGS.has(i.str.trim()) && i.fontSize >= MIN_MARK_FONT,
    )
    const labelItemsOf = (items: TextItem[]): TextItem[] =>
      items.filter((i) => i.bbox[2] <= firstColumnX + 2 && i.str.trim().length > 0)

    // --- Tope del encabezado repetido: nada por encima de la fila de ventana
    // (o del encabezado de fichas) es fila.
    let headerCeiling = -Infinity
    for (const item of page.items) {
      if (WINDOW_ROW_RE.test(item.str.trim())) headerCeiling = Math.max(headerCeiling, item.bbox[3])
    }
    if (headerCeiling === -Infinity && headerGroups.length > 0) {
      headerCeiling = headerY
    }

    // --- Filas: intervalos entre bordes H con contenido, o clusters de líneas
    // base si los bordes no alcanzan (tablas "bordered=false" de F2).
    const edgeBands: Array<[number, number]> = []
    for (let i = 0; i + 1 < hys.length; i++) edgeBands.push([hys[i]!, hys[i + 1]!])
    const isContent = (yTop: number, y0: number, y1: number): boolean => {
      if (yTop > headerCeiling + 1) return false
      const label = labelItemsOf(page.items).some(
        (i) => (i.bbox[1] + i.bbox[3]) / 2 >= y0 && (i.bbox[1] + i.bbox[3]) / 2 <= y1,
      )
      const mark = marks.some((m) => m.bbox[1] >= y0 - 0.5 && m.bbox[1] <= y1 + 0.5)
      return label || mark
    }
    const edgeRows: Array<[number, number]> = edgeBands.filter(([y0, y1]) => isContent(y1, y0, y1))

    // Clusters de líneas base con contenido (etiqueta o marca): una línea a
    // menos de ROW_CLUSTER_GAP de la anterior es la misma fila (etiqueta
    // multilínea); un salto mayor corta la fila.
    const contentLines = bands.filter((band) => {
      if (band.y > headerCeiling + 1) return false
      return (
        labelItemsOf(band.items).length > 0 || band.items.some((i) => marks.includes(i))
      )
    })
    const clusters: Array<Array<ItemBand>> = []
    for (const band of contentLines) {
      const last = clusters[clusters.length - 1]
      const prev = last?.[last.length - 1]
      if (prev && prev.y - band.y <= ROW_CLUSTER_GAP) {
        last.push(band)
      } else {
        clusters.push([band])
      }
    }

    // Con bordes de fila trazados por celda los bordes SON la fila (el gold
    // es el intervalo entre bordes); los clusters de líneas base son el
    // fallback de las tablas "bordered=false" (F2), donde parten etiquetas
    // multilínea en filas falsas.
    const useEdges = edgeRows.length >= 2

    const rowBands: RowBand[] = []
    if (useEdges) {
      for (const [y0, y1] of edgeRows) {
        const labelItems = labelItemsOf(page.items).filter(
          (i) => (i.bbox[1] + i.bbox[3]) / 2 >= y0 && (i.bbox[1] + i.bbox[3]) / 2 <= y1,
        )
        rowBands.push({
          y0,
          y1,
          labelItems,
          marks: marks.filter((m) => m.bbox[1] >= y0 - 0.5 && m.bbox[1] <= y1 + 0.5),
          isAttribute: ATTRIBUTE_RE.test(labelItems.map((i) => i.str.trim()).join(' ')),
        })
      }
    } else {
      // Sin bordes de fila, la retícula la marcan las líneas de contenido:
      // el generador escribe la primera línea de la fila a 3 pt del fondo, y
      // las filas siguen el salto dominante entre líneas (mediana). La tabla
      // transpuesta de F2 (visitas lado a lado, filas intercaladas) también
      // cae acá: cada línea es una fila de la retícula.
      const gaps: number[] = []
      for (let i = 0; i + 1 < contentLines.length; i++) {
        const gap = contentLines[i]!.y - contentLines[i + 1]!.y
        if (gap > 2 && gap <= 30) gaps.push(gap)
      }
      gaps.sort((a, b) => a - b)
      const pitch = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)]! : 0
      const gridded = pitch >= 8 && pitch <= 30
      for (const cluster of clusters) {
        const items = cluster.flatMap((b) => b.items)
        const box = boxOf(items.filter((i) => labelItemsOf(items).includes(i) || marks.includes(i)))
        if (!box) continue
        const labelItems = labelItemsOf(items)
        const y0 = gridded ? box[1] - 3 : box[1] - 2
        const y1 = gridded ? y0 + pitch : box[3] + 2
        rowBands.push({
          y0,
          y1,
          labelItems,
          marks: marks.filter((m) => m.bbox[1] >= y0 - 0.5 && m.bbox[1] <= y1 + 0.5),
          isAttribute: ATTRIBUTE_RE.test(labelItems.map((i) => i.str.trim()).join(' ')),
        })
      }
    }

    // Bandas de fila de atributo para G7 (acumuladas por página): sus
    // superíndices quedan sin celda POR DISEÑO (las filas de atributo no
    // emiten celdas), no es pérdida.
    pageAttrBands.push(
      ...rowBands.filter((b) => b.isAttribute).map((b) => [b.y0, b.y1] as [number, number]),
    )

    // --- RawRow por banda (de arriba a abajo = orden de lectura).
    for (const [bandIdx, band] of rowBands.entries()) {
      const label = band.labelItems.map((i) => i.str.trim()).join(' ')
      const continued =
        bandIdx === 0 &&
        regionIdx === 0 &&
        pageNumber > (located.pages[0] ?? pageNumber) &&
        label.length === 0 &&
        lastRowIndex >= 0
      const index = continued ? lastRowIndex : rows.length
      rows.push({
        index,
        page: pageNumber,
        label,
        labelBBox: boxOf(band.labelItems) ?? [0, band.y0, 0, band.y1],
        y0: band.y0,
        y1: band.y1,
        continuedFromPrevPage: continued,
        isAttributeCandidate: ATTRIBUTE_RE.test(label),
      })
      if (!continued) lastRowIndex = index
    }

    // --- Índice de columna de la tabla para una banda local: ficha de la
    // banda → columna registrada con esa ficha; con fichas repetidas (los
    // "—" de F3), la posición ordinal entre las candidatas; sin ficha, la
    // ordinal local.
    const tableColOfBand = (band: [number, number]): number => {
      const local = localColumns.findIndex((lc) => lc.band === band)
      const token = localColumns[local]?.token ?? null
      let tableCol = -1
      if (token !== null) {
        const candidates = columnTokens.flatMap((tokens, i) => (tokens.has(token) ? [i] : []))
        if (candidates.length === 1) {
          tableCol = candidates[0]!
        } else if (candidates.length > 1) {
          const sameTokenLocals = localColumns.flatMap((lc, i) => (lc.token === token ? [i] : []))
          tableCol = candidates[Math.min(Math.max(sameTokenLocals.indexOf(local), 0), candidates.length - 1)]!
        }
      }
      return tableCol >= 0 ? tableCol : local >= 0 ? local : 0
    }

    // G1: qué columnas de tabla tienen ficha de encabezado en esta región;
    // el conjunto se acumula por página.
    const regionHeaderCols = new Set<number>()
    for (const lc of localColumns) {
      if (lc.token === null) continue
      regionHeaderCols.add(tableColOfBand(lc.band))
    }
    for (const col of regionHeaderCols) pageHeaderCols.add(col)

    // --- Celdas: cada marca cae en una columna (centro-x) y una fila (base de caja).
    // G3 ("ninguna marca sin dueño") compara TODAS las marcas de la página
    // contra las celdas emitidas: las de una fila de atributo ("Ayuno"…,
    // ADR-10 §2.2 b) cuentan como presentes pero no son celdas; las que no
    // caen en banda de columna/fila quedan presentes sin dueño. Los
    // contadores son POR PÁGINA (se acumulan entre regiones).
    for (const mark of marks) {
      const colIdx = effBands.findIndex(
        ([x0, x1]) => center(mark) >= x0 - 0.5 && center(mark) <= x1 + 0.5,
      )
      const rowIdx = rowBands.findIndex(
        (band) => mark.bbox[1] >= band.y0 - 0.5 && mark.bbox[1] <= band.y1 + 0.5,
      )
      marksPresent++
      // Tipo de la pérdida, en este orden: sin banda-x, banda sin ficha de
      // encabezado, sin fila. present = attr + assigned + lost, siempre.
      if (colIdx < 0) {
        lost.sinColumna++
        continue
      }
      if (!localColumns.some((lc) => lc.band === effBands[colIdx])) {
        lost.bandaSinFicha++
        continue
      }
      if (rowIdx < 0) {
        lost.sinFila++
        continue
      }
      if (rowBands[rowIdx]!.isAttribute) {
        marksAttr++
        continue
      }

      const tableCol = tableColOfBand(effBands[colIdx]!)
      const [cx0, cx1] = effBands[colIdx]!
      const band = rowBands[rowIdx]!
      const width = Math.max(cx1 - cx0, 1e-6)
      cells.push({
        page: pageNumber,
        rowIndex: rows.findIndex((r) => r.page === pageNumber && r.y0 === band.y0 && r.y1 === band.y1),
        colIndex: columns[tableCol]?.index ?? tableCol,
        text: mark.str.trim(),
        bbox: [cx0, band.y0, cx1, band.y1],
        kind: 'mark',
        spanCols: [],
        noteRefs: [],
        distanceToCenter: Math.min(Math.abs(center(mark) - (cx0 + cx1) / 2) / width, 1),
      })
      marksAssigned++
    }

    // --- Fila de ventana: la banda del "Ventana…" con sus textos por grupo
    // de ventana. El generador dibuja cada grupo como UNA caja que cruza
    // solo esa banda, así que el span de un texto es el INTERVALO entre
    // bordes que lo contiene — nunca el ancho del texto, que va centrado en
    // el grupo y no alcanza a cubrirlo (F1 T1: 8 textos cubren las 26).
    const windowBand = bands.find(
      (b) => b.items.some((i) => WINDOW_ROW_RE.test(i.str.trim())) && Math.abs(b.y - headerCeiling) <= 2,
    )
    if (windowBand) {
      const labels = labelItemsOf(windowBand.items)
      const wBox = boxOf(windowBand.items)!
      rows.push({
        index: rows.length,
        page: pageNumber,
        label: labels.map((i) => i.str.trim()).join(' '),
        labelBBox: boxOf(labels) ?? [0, wBox[1], 0, wBox[3]],
        y0: wBox[1],
        y1: wBox[3],
        continuedFromPrevPage: false,
        isAttributeCandidate: false,
      })
      const windowCells: RawCell[] = []
      // Textos de la fila de ventana en las bandas ±2: el grupo partido en
      // tokens ("Hast"+"a"+"42"+"d") se dibuja en fuente 5, así que su techo
      // queda 1 pt por debajo del resto (fuente 6) y en otra banda.
      const windowTexts = bands
        .filter((b) => Math.abs(b.y - windowBand.y) <= 2)
        .flatMap((b) => b.items)
        .filter(
          (i) =>
            i.bbox[0] >= firstColumnX - 2 &&
            i.str.trim().length > 0 &&
            !MARK_STRINGS.has(i.str.trim()) &&
            i.fontSize >= 4,
        )
      // Cajas de grupo: bordes V que cruzan la banda ventana (los de las
      // bandas vecinas —timing, atributos— no llegan a entrar con margen).
      const winIntervals = rowIntervals(page, wBox[1] + 1, wBox[3] - 1).filter(
        ([, b]) => b > firstColumnX,
      )
      for (const group of groupTexts(windowTexts)) {
        // El intervalo de mayor solape con el texto es el grupo del texto.
        let box: [number, number] | null = null
        let bestOverlap = 0
        for (const interval of winIntervals) {
          const overlap = Math.min(group.x1, interval[1]) - Math.max(group.x0, interval[0])
          if (overlap > bestOverlap) {
            bestOverlap = overlap
            box = interval
          }
        }
        // Columnas del grupo: las bandas locales con centro dentro de la
        // caja (sin bordes de caja, por solape del texto).
        const spanOf = (band: [number, number]): boolean => {
          const cx = (band[0] + band[1]) / 2
          return box !== null && cx >= box[0] - 0.5 && cx <= box[1] + 0.5
        }
        const spans = localColumns.filter((lc) =>
          box
            ? spanOf(lc.band)
            : lc.band[0] < group.x1 && lc.band[1] > group.x0,
        )
        if (spans.length === 0) continue
        const tableCols = spans.map((lc) => tableColOfBand(lc.band))
        windowCells.push({
          page: pageNumber,
          rowIndex: rows.length - 1,
          colIndex: tableCols[0]!,
          text: group.text,
          bbox: box
            ? [box[0], wBox[1], box[1], wBox[3]]
            : [spans[0]!.band[0], wBox[1], spans[spans.length - 1]!.band[1], wBox[3]],
          kind: tableCols.length > 1 ? 'merged' : 'text',
          spanCols: tableCols,
          noteRefs: [],
          distanceToCenter: 0,
        })
      }
      cells.push(...windowCells)
      windowRowIndexes.add(rows.length - 1)
      pageWindowBand = pageWindowBand
        ? [Math.min(pageWindowBand[0], wBox[1]), Math.max(pageWindowBand[1], wBox[3])]
        : [wBox[1], wBox[3]]
      // G2 por página (F3 imprime una tabla en tiras de columnas): la ventana
      // de ESA página debe cubrir las columnas con FICHA de esa página — el
      // generador solo dibuja grupos de ventana sobre fichas de visita, no
      // sobre los "—" que acompañan a las tiras.
      const visitable = localColumns.filter((lc) => lc.token !== null && lc.token !== '—').length
      windowCoverage.push({
        page: pageNumber,
        covered: new Set(windowCells.flatMap((c) => c.spanCols)).size,
        local: visitable,
        hasText: windowCells.length > 0,
      })
      windowRow ??= { rowIndex: rows.length - 1, cells: [] }
      if (windowRow.rowIndex === rows.length - 1) windowRow.cells = windowCells
    }

    // --- Rangos "según necesidad" en filas normales: una CORRIDA de celdas
    // vacías consecutivas con un único texto centrado encima (el generador
    // NO dibuja la caja de la corrida: cada celda conserva su borde). El
    // alcance exacto no es visible en la página — se reporta el bloque
    // contiguo de columnas SIN marca ni otro texto alrededor de la corrida,
    // que contiene a la corrida real (en F2, la fila entera de visitas).
    for (const band of rowBands) {
      if (band.isAttribute) continue
      const texts = page.items.filter(
        (i) =>
          !MARK_STRINGS.has(i.str.trim()) &&
          i.str.trim().length > 0 &&
          i.fontSize >= 5 &&
          i.bbox[0] >= firstColumnX - 2 &&
          (i.bbox[1] + i.bbox[3]) / 2 >= band.y0 &&
          (i.bbox[1] + i.bbox[3]) / 2 <= band.y1 &&
          !windowBand?.items.includes(i),
      )
      const groups = groupTexts(texts)
      if (groups.length === 0) continue
      const rowIdx = rows.findIndex(
        (r) => r.page === pageNumber && r.y0 === band.y0 && r.y1 === band.y1,
      )
      if (rowIdx < 0) continue
      // Columna ocupada: una marca de la fila o el centro de un grupo de
      // texto (la corrida se corta contra ambas).
      const occupied = [
        ...band.marks.map((m) => center(m)),
        ...groups.map((g) => (g.x0 + g.x1) / 2),
      ]
      const isFree = (bandX: [number, number]): boolean =>
        !occupied.some((o) => o >= bandX[0] - 0.5 && o <= bandX[1] + 0.5)
      for (const group of groups) {
        if (!PRN_RE.test(group.text.replace(/\s+/g, ' ').toLowerCase())) continue
        const gCenter = (group.x0 + group.x1) / 2
        let start = localColumns.findIndex(
          (lc) => gCenter >= lc.band[0] && gCenter <= lc.band[1],
        )
        if (start < 0) {
          // Centro entre dos columnas: la de mayor solape con el texto.
          let bestOverlap = 0
          localColumns.forEach((lc, i) => {
            const overlap = Math.min(group.x1, lc.band[1]) - Math.max(group.x0, lc.band[0])
            if (overlap > bestOverlap) {
              bestOverlap = overlap
              start = i
            }
          })
        }
        if (start < 0) continue
        let lo = start
        while (lo > 0 && isFree(localColumns[lo - 1]!.band)) lo--
        let hi = start
        while (hi + 1 < localColumns.length && isFree(localColumns[hi + 1]!.band)) hi++
        const tableCols: number[] = []
        for (let i = lo; i <= hi; i++) tableCols.push(tableColOfBand(localColumns[i]!.band))
        cells.push({
          page: pageNumber,
          rowIndex: rowIdx,
          colIndex: tableCols[0]!,
          text: group.text,
          bbox: [localColumns[lo]!.band[0], band.y0, localColumns[hi]!.band[1], band.y1],
          kind: tableCols.length > 1 ? 'merged' : 'text',
          spanCols: tableCols,
          noteRefs: [],
          distanceToCenter: 0,
        })
      }
    }

    // Fondo de la grilla de la región para las notas al pie (la más baja de
    // las regiones de la página: las notas viven debajo de la última fila).
    if (rowBands.length > 0) lastBottom = Math.min(lastBottom, ...rowBands.map((b) => b.y0))

    } // — fin de las regiones de la página

    // --- Estado POR PÁGINA tras leer todas sus regiones (G1/G3/G4/G7 leen
    // por página, no por tira).
    markStats.push({
      page: pageNumber,
      present: marksPresent,
      attr: marksAttr,
      assigned: marksAssigned,
      lost,
    })
    firstColByPage.set(pageNumber, pageFirstColX)
    headerColsByPage.set(pageNumber, pageHeaderCols)
    if (pageSpan) columnSpanByPage.set(pageNumber, pageSpan)
    if (pageAttrBands.length > 0) attrBandsByPage.set(pageNumber, pageAttrBands)
    if (pageWindowBand) windowBandByPage.set(pageNumber, pageWindowBand)

    // --- Llamadas de nota (§3): superíndices (≤ 0,75 × la mediana de fuente
    // de la página) pegados a una celda de marca. El vínculo es por
    // proximidad al centro de la celda: en columnas sombreadas el
    // superíndice se escribe sobre el techo de la fila, no junto a la marca.
    // Corre sobre la página COMPLETA: los superíndices pueden colgarse de
    // celdas de cualquier región.
    const fontSizes = srcPage.items.map((i) => i.fontSize).sort((a, b) => a - b)
    const medianFont = fontSizes[Math.floor(fontSizes.length / 2)] ?? 6
    const pageMarkCells = cells.filter((c) => c.page === pageNumber && c.kind === 'mark')
    for (const item of srcPage.items) {
      const ref = item.str.trim()
      if (item.fontSize > medianFont * 0.75 || !NOTE_REF_RE.test(ref)) continue
      // Continuación de palabra partida, no superíndice: el candidato ARRANCA
      // dentro del rango-x de otro ítem de texto de la misma línea (el "a"
      // final de "Hast"+"a" de la fila de ventana — pdfjs solapa los anchos
      // por kerning). Un superíndice real va a la izquierda de su texto o
      // solo; la marca no cuenta como palabra (el ref se cuelga de ella).
      const glued = srcPage.items.some(
        (other) =>
          other !== item &&
          !MARK_STRINGS.has(other.str.trim()) &&
          other.str.trim().length > 0 &&
          item.bbox[0] >= other.bbox[0] - 0.5 &&
          item.bbox[0] < other.bbox[2] - 0.5 &&
          other.bbox[3] > item.bbox[1] - 2 &&
          other.bbox[1] < item.bbox[3] + 2,
      )
      if (glued) continue
      const sx = (item.bbox[0] + item.bbox[2]) / 2
      const sy = (item.bbox[1] + item.bbox[3]) / 2
      let best: RawCell | null = null
      let bestDist = Infinity
      for (const cell of pageMarkCells) {
        const cx = (cell.bbox[0] + cell.bbox[2]) / 2
        const cy = (cell.bbox[1] + cell.bbox[3]) / 2
        if (Math.abs(sx - cx) > 10 || Math.abs(sy - cy) > 14) continue
        const dist = Math.abs(sx - cx) + Math.abs(sy - cy)
        if (dist < bestDist) {
          bestDist = dist
          best = cell
        }
      }
      if (best && !best.noteRefs.includes(ref)) best.noteRefs.push(ref)
    }

    // --- Notas al pie de la grilla (generador: comment_w, F2 T2): mismas
    // líneas de nota, dibujadas debajo de la última fila de la página (la
    // más baja de todas las regiones).
    for (const item of srcPage.items) {
      const match = item.str.trim().match(NOTE_LINE_RE)
      if (!match || item.fontSize < NOTE_FONT_MIN || item.fontSize > NOTE_FONT_MAX) continue
      const cy = (item.bbox[1] + item.bbox[3]) / 2
      if (cy >= lastBottom - 2) continue
      notes.push({
        ref: match[1]!,
        page: pageNumber,
        text: match[2]!.trim(),
        bbox: item.bbox,
      })
    }

    // --- G7 (R2) y K1: texto pequeño no consumido y texto rotado en la zona
    // de grilla. "No consumido" = el centro del ítem no cae en ninguna celda
    // emitida de la página (±2 en x, ±4 en y — en columnas sombreadas el
    // superíndice se dibuja pegado al techo de la fila y queda ~3 pt por
    // encima de la banda). Encima de la fila de ventana, a la izquierda de la
    // primera columna, en bandas de fila de ATRIBUTO y las fichas de día
    // ("D -1") es estructura (encabezado, etiquetas, ejes), no contenido
    // perdido.
    let rotated = 0
    let tiny = 0
    const pageCells = cells.filter((c) => c.page === pageNumber)
    const wBand = windowBandByPage.get(pageNumber)
    const fcx = firstColByPage.get(pageNumber) ?? Infinity
    for (const item of srcPage.items) {
      if (item.rotated) rotated++
      const s = item.str.trim()
      if (s.length === 0 || item.fontSize >= TINY_FONT_MAX || item.fontSize <= 0) continue
      if (DAY_TOKEN_RE.test(s)) continue
      if (item.bbox[0] < fcx - 2) continue
      const cy = (item.bbox[1] + item.bbox[3]) / 2
      if (wBand && cy > wBand[1] + 2) continue
      if (pageAttrBands.some(([y0, y1]) => cy >= y0 - 3 && cy <= y1 + 3)) continue
      const cx = (item.bbox[0] + item.bbox[2]) / 2
      if (
        !pageCells.some(
          (c) =>
            cx >= c.bbox[0] - 2 &&
            cx <= c.bbox[2] + 2 &&
            cy >= c.bbox[1] - 4 &&
            cy <= c.bbox[3] + 4,
        )
      ) {
        tiny++
      }
    }
    if (rotated > 0) rotatedByPage.set(pageNumber, rotated)
    if (tiny > 0) tinyUnconsumed.push({ page: pageNumber, count: tiny })
  }

  // --- Chequeos geométricos §4. Cada uno pasa o deja la tabla en 'partial'
  // con 'validation_failed:<id>' (ADR-10 §e); los details son solo conteos,
  // sin texto del documento.
  const checks: RawTable['checks'] = []

  // G1 (por página, ADR-10 §d-1 y R5/G10): las columnas con ficha de
  // encabezado tienen contenido. Dos lecturas, ambas por página:
  // - una columna sin contenido en NINGUNA página es fallo de la tabla;
  // - una columna vacía SOLO en UNA página, con contenido en todas las
  //   demás donde tiene ficha, es una página desincronizada (R5/G10:
  //   F1 p21 con la columna 0 vaciada; el agregado por tabla lo escondía).
  // Las columnas que el documento llena parcialmente — las tiras de F3
  // rotan qué visitas tienen procedimiento en cada página, verificado
  // contra el gold: p22 tiene 13 de 19 — NO disparan: no están llenas en
  // todas las demás. El contenido cuenta fuera de la fila de ventana
  // (G2 la controla aparte) e incluye lo que cubre una combinada.
  const coveredByPage = new Map<number, Set<number>>()
  for (const cell of cells) {
    if (windowRowIndexes.has(cell.rowIndex)) continue
    const covered = coveredByPage.get(cell.page) ?? new Set<number>()
    covered.add(cell.colIndex)
    for (const sc of cell.spanCols) covered.add(sc)
    coveredByPage.set(cell.page, covered)
  }
  const headerCount = new Map<number, number>()
  const filledCount = new Map<number, number>()
  for (const [page, cols] of headerColsByPage) {
    const covered = coveredByPage.get(page)
    for (const c of cols) {
      headerCount.set(c, (headerCount.get(c) ?? 0) + 1)
      if (covered?.has(c)) filledCount.set(c, (filledCount.get(c) ?? 0) + 1)
    }
  }
  const neverFilled = [...headerCount.entries()]
    .filter(([c, headers]) => (filledCount.get(c) ?? 0) === 0 && headers > 0)
    .map(([c]) => c)
    .sort((a, b) => a - b)
  const g1bad: string[] = []
  for (const [page, cols] of headerColsByPage) {
    const covered = coveredByPage.get(page)
    const desync = [...cols]
      .filter(
        (c) =>
          !covered?.has(c) &&
          (filledCount.get(c) ?? 0) === (headerCount.get(c) ?? 1) - 1,
      )
      .sort((a, b) => a - b)
    if (desync.length > 0) g1bad.push(`p${page}: c${desync.join(',c')}`)
  }
  const g1pass = neverFilled.length === 0 && g1bad.length === 0
  checks.push({
    id: 'G1',
    pass: g1pass,
    detail: g1pass
      ? `contenido en ${headerColsByPage.size} pág., ${columns.length} columnas`
      : [
          neverFilled.length > 0 ? `columnas sin contenido: c${neverFilled.join(',c')}` : null,
          g1bad.length > 0 ? `vacía solo en ${g1bad.join('; ')}` : null,
        ]
          .filter((s) => s !== null)
          .join(' · '),
  })

  // C2 (P2c): las columnas sin contenido en NINGUNA página quedan marcadas
  // en el crudo (K1): la ficha no desaparece, P3 la ve vacía — mismo
  // criterio de contenido que G1 (sin la fila de ventana).
  const coveredCols = new Set<number>()
  for (const covered of coveredByPage.values()) for (const c of covered) coveredCols.add(c)
  for (const col of columns) col.empty = !coveredCols.has(col.index)

  // G2: en cada página con textos de ventana, la ventana cubre todas las
  // columnas de esa página tras expandir las combinadas.
  const g2bad = windowCoverage.filter((w) => w.hasText && w.covered !== w.local)
  checks.push({
    id: 'G2',
    pass: g2bad.length === 0,
    detail:
      windowCoverage.length === 0
        ? 'sin fila de ventana'
        : g2bad.length === 0
          ? `ventana completa en ${windowCoverage.length} pág.`
          : `sin cubrir en ${g2bad.map((w) => `p${w.page} ${w.covered}/${w.local}`).join(', ')}`,
  })

  // G3: ninguna marca sin dueño — presentes menos las de filas de atributo
  // iguales a las celdas emitidas, página por página.
  const g3bad = markStats.filter((s) => s.present - s.attr !== s.assigned)
  checks.push({
    id: 'G3',
    pass: g3bad.length === 0,
    detail:
      g3bad.length === 0
        ? `marcas con dueño en ${markStats.length} pág.`
        : g3bad
            .map((s) => {
              const kinds = [
                s.lost.sinColumna > 0 ? `sin_columna:${s.lost.sinColumna}` : '',
                s.lost.bandaSinFicha > 0 ? `banda_sin_ficha:${s.lost.bandaSinFicha}` : '',
                s.lost.sinFila > 0 ? `sin_fila:${s.lost.sinFila}` : '',
              ].filter((k) => k !== '')
              return `p${s.page} ${s.assigned}/${s.present - s.attr}${kinds.length > 0 ? ` [${kinds.join(' ')}]` : ''}`
            })
            .join(', '),
  })

  // G4: una fila normal vacía solo es sospechosa si HAY contenido de celda
  // visible que no se entregó — una fila de procedimiento sin marcas (o la
  // media fila del split en la zona de etiquetas) es legítimamente vacía;
  // decidir si es "narrativa" es semántica de P3. Las marcas perdidas las
  // pesca G3; acá queda el TEXTO de zona de columnas sin celda (una corrida
  // "según necesidad" que no se combinó, un valor suelto).
  const rowsWithCells = new Set(
    cells.filter((c) => !windowRowIndexes.has(c.rowIndex)).map((c) => c.rowIndex),
  )
  const g4bad: string[] = []
  let g4InColumn = 0
  let g4Outside = 0
  for (const row of rows) {
    if (
      row.isAttributeCandidate ||
      DAY_ROW_RE.test(row.label) ||
      row.continuedFromPrevPage ||
      windowRowIndexes.has(row.index) ||
      rowsWithCells.has(row.index)
    ) {
      continue
    }
    // Banda de bordes que ENGLOBA la fila de ventana (la ventana de dos
    // líneas da dos intervalos: el justo y el que la contiene entera): es la
    // misma fila, no una vacía.
    const engulfsWindow = rows.some(
      (w) =>
        w.page === row.page &&
        w.index !== row.index &&
        windowRowIndexes.has(w.index) &&
        w.y0 >= row.y0 - 1 &&
        w.y1 <= row.y1 + 1,
    )
    if (engulfsWindow) continue
    const page = byPage.get(row.page)
    if (!page) continue
    const firstColumnX = firstColByPage.get(row.page) ?? Infinity
    const wBand = windowBandByPage.get(row.page)
    const visibleItems = page.items.filter((i) => {
      const s = i.str.trim()
      if (s.length === 0 || MARK_STRINGS.has(s) || FOLIO_TEXT_RE.test(s)) return false
      if (i.fontSize < 5 || i.bbox[0] < firstColumnX - 2) return false
      const cy = (i.bbox[1] + i.bbox[3]) / 2
      if (wBand && cy >= wBand[0] - 1 && cy <= wBand[1] + 1) return false
      return cy >= row.y0 && cy <= row.y1
    })
    if (visibleItems.length > 0) {
      g4bad.push(`p${row.page}·f${row.index}`)
      // Tipo: algún texto dentro del rango de columnas con ficha, o todo fuera
      // (a la derecha: tira de comentarios, texto de margen).
      const span = columnSpanByPage.get(row.page)
      const inside = visibleItems.some((i) => {
        const cx = (i.bbox[0] + i.bbox[2]) / 2
        return span !== undefined && cx >= span[0] && cx <= span[1]
      })
      if (inside) g4InColumn++
      else g4Outside++
    }
  }
  checks.push({
    id: 'G4',
    pass: g4bad.length === 0,
    detail:
      g4bad.length === 0
        ? `filas ${rows.length}, vacías sin contenido perdido`
        : g4bad.slice(0, 6).join(', ') +
          (g4bad.length > 6 ? ` (+${g4bad.length - 6})` : '') +
          ` [${[
            g4InColumn > 0 ? `texto_en_columna:${g4InColumn}` : '',
            g4Outside > 0 ? `texto_fuera_de_columnas:${g4Outside}` : '',
          ]
            .filter((k) => k !== '')
            .join(' ')}]`,
  })

  // G5: sin dos columnas de la misma página a menos de 3 pt de centro.
  const g5detail = columnCenterCollisions(columns)
  checks.push({
    id: 'G5',
    pass: g5detail === null,
    detail: g5detail ?? 'sin columnas superpuestas',
  })

  // G6 (K1): toda llamada de nota de una celda tiene texto de nota — los
  // refs ÚNICOS de las celdas contra los refs de las notas de la tabla. Sin
  // texto hay pérdida silenciosa (F2 T2: notas dibujadas fuera de los rangos
  // del extractor), y la tabla baja a 'partial' con la cantidad.
  const cellRefSet = new Set(cells.flatMap((c) => c.noteRefs))
  const noteRefSet = new Set(notes.map((n) => n.ref))
  const orphanRefs = [...cellRefSet].filter((r) => !noteRefSet.has(r)).length
  const g6pass = orphanRefs === 0
  checks.push({
    id: 'G6',
    pass: g6pass,
    detail: g6pass ? `refs ${cellRefSet.size} con nota` : `refs sin nota: ${orphanRefs}`,
  })

  // G7 (R2): sin texto pequeño no consumido en la zona de grilla — un ítem
  // diminuto (< 6 pt) fuera de toda celda es contenido que el lector pierde
  // en silencio (notas al costado de la grilla, marcas diminutas).
  const tinyTotal = tinyUnconsumed.reduce((acc, t) => acc + t.count, 0)
  checks.push({
    id: 'G7',
    pass: tinyTotal === 0,
    detail:
      tinyTotal === 0
        ? 'sin texto pequeño perdido'
        : tinyUnconsumed.map((t) => `p${t.page}: ${t.count}`).join(', '),
  })

  // --- Outcome (ADR-10 §e): sin páginas/columnas no hay grilla; si falla un
  // chequeo la tabla queda 'partial' con su motivo. Cortes de documento: la
  // última página del PDF siendo de grilla de esta tabla = tabla truncada
  // (los sanos terminan en notas/pad, nunca en grilla); el tope de seguridad
  // de 100 páginas marca sin cortar la lectura.
  const reasons: string[] = []
  let outcome: RawTable['outcome']
  // Marcas del conjunto reconocido en toda la tabla (K1).
  const totalMarks = markStats.reduce((acc, s) => acc + s.present, 0)
  if (located.pages.length === 0) {
    outcome = 'failed'
    reasons.push('not_located')
  } else if (missingPages.length > 0 || columns.length === 0) {
    // 'grid_unreadable': sin columnas no hay grilla (ADR-10 §e), y una
    // página localizada AUSENTE del input (R7) hace la lectura imposible —
    // jamás un salto silencioso de página.
    outcome = 'failed'
    reasons.push('grid_unreadable')
  } else if (totalMarks === 0) {
    // K1 (G12): el localizador conservó esta racha porque tiene encabezado,
    // pero ni una marca del conjunto reconocido apareció (un glifo que no
    // conocemos, o una tabla de abreviaturas con fichas V1…). La tabla NO se
    // puede leer y no puede quedar como grilla vacía que parezca «sin
    // cronograma»: sale `failed` visible con 'no_marks'.
    outcome = 'failed'
    reasons.push('no_marks')
  } else {
    const failed = checks.filter((c) => !c.pass)
    outcome = failed.length === 0 ? 'complete' : 'partial'
    reasons.push(...failed.map((c) => `validation_failed:${c.id}`))
  }
  if (outcome !== 'failed') {
    if (located.pages.at(-1) === lastDocPage) {
      outcome = 'partial'
      reasons.push('truncated_pages')
    }
    if (located.pages.length > PAGE_LIMIT) {
      outcome = 'partial'
      reasons.push('page_limit')
    }
    // K1: con llamadas de nota huérfanas, el texto rotado (transform b/c ≠ 0)
    // de las páginas de grilla es la explicación geométrica de la pérdida —
    // el lector no extrae contenido de texto rotado. Solo acompaña a un G6
    // fallido: un rotado sin pérdida (folio lateral, decoración) no baja la
    // tabla. En los fixtures no hay texto rotado; la señal queda para SoAs
    // reales.
    if (!g6pass && rotatedByPage.size > 0) {
      reasons.push('rotated_text')
    }
  }

  return {
    key: located.key,
    pages: [...located.pages],
    columns,
    rows,
    cells,
    windowRow,
    notes,
    checks,
    outcome,
    reasons,
  }
}

/**
 * G5 (§4-5): sin dos columnas de la MISMA página a menos de 3 pt de centro
 * EN LA MISMA FRANJA VERTICAL (P2c C1b): las tiras de encabezado apiladas
 * comparten la grilla x — V1 vive sobre V9 — y son columnas legítimas; la
 * colisión exige que las cajas de encabezado también se solapen en y.
 * Extraído como función pura porque por mutación de ENTRADA no es
 * alcanzable: `groupTexts` une fichas a ≤6 pt y la subdivisión de bandas
 * corta por puntos medios, así que dos columnas vecinas con sendas fichas
 * quedan a ≥3 pt SIEMPRE (el invariante está asertado en tests con fichas
 * a 6.01 pt). Este chequeo es la red si ese invariante se rompe — relajar
 * el agrupador o los cortes — y su rama de falla se prueba acá directo,
 * con columnas sintéticas.
 */
export function columnCenterCollisions(columns: RawColumn[]): string | null {
  const byPage = new Map<number, Array<{ xCenter: number; y0: number; y1: number }>>()
  for (const col of columns) {
    const arr = byPage.get(col.page)
    const entry = { xCenter: col.xCenter, y0: col.headerBBox[1], y1: col.headerBBox[3] }
    if (arr) arr.push(entry)
    else byPage.set(col.page, [entry])
  }
  const bad: string[] = []
  for (const [page, cols] of byPage) {
    cols.sort((a, b) => a.xCenter - b.xCenter)
    let hit = false
    for (let i = 0; i < cols.length && !hit; i++) {
      for (let j = i + 1; j < cols.length && cols[j]!.xCenter - cols[i]!.xCenter < 3; j++) {
        const a = cols[i]!
        const b = cols[j]!
        if (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0) {
          hit = true
          break
        }
      }
    }
    if (hit) bad.push(`p${page}`)
  }
  return bad.length === 0 ? null : bad.join(', ')
}

/**
 * Etapa (b): la grilla cruda de cada tabla localizada. Determinista y puro;
 * sin tope de 30 páginas (D2) — se lee todo lo localizado.
 */
export function readGrid(pages: PageGeom[], location: ScheduleLocation): RawSchedule {
  const byPage = new Map(pages.map((p) => [p.page, p]))
  const lastDocPage = pages.length > 0 ? pages[pages.length - 1]!.page : 0
  return {
    tables: location.tables.map((table) => readTable(table, byPage, lastDocPage)),
    location,
  }
}
