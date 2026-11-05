/**
 * grid.ts — etapa (b): leer la grilla cruda por tabla (ADR-10 §2.2 b).
 *
 * Todo por página y en el espacio de usuario SIN rotar (igual que el gold):
 * cada página de grilla trae sus propias fronteras de celda, así que
 * columnas, filas y celdas se leen con la geometría LOCAL de la página. Sin
 * modelo, sin red, sin logs (S8).
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
 * `checks` y `outcome` llegan con el commit de G1–G5; hasta entonces la
 * tabla sale `partial` con `checks_pending`.
 */
import type {
  PageGeom,
  RawCell,
  RawColumn,
  RawRow,
  RawSchedule,
  RawTable,
  ScheduleLocation,
  TextItem,
} from './types'

/** Marcas de celda de la capa de texto (el generador escribe 'X' en DejaVu 7). */
const MARK_STRINGS = new Set(['x', 'X', '✓', '●', '•'])

/** Fichas de visita del encabezado (mismo criterio que locate). */
const VISIT_TOKEN = /^(V|VR|S|W|D)\d+$|^(SCR|DT|FA|SEL|ET|FU|EOS|EOT|VNP|VF|VME\d+|VDT|VME)$/i

/** Fila de ventana (etiqueta de la banda). */
const WINDOW_ROW_RE =
  /^(ventana|window|margen de visita|intervalo de tolerancia|visit window|tolerance)\b/i

/** Léxico de fila de atributo (ADR-10 §2.2 b: la clasificación fina es P3). */
const ATTRIBUTE_RE =
  /(ayuno|fasting|visita a la clínica|on ?site|presencial|tipo de visita|visit type)/i

/** Tolerancia de agrupado de fronteras (pt). */
const EDGE_EPSILON = 1
/** Tamaño mínimo de una frontera para contar (pt). */
const MIN_EDGE_LENGTH = 6
/** Fuente por debajo de la cual una ficha es superíndice de nota, no marca. */
const MIN_MARK_FONT = 5
/** Separación entre líneas base que corta un cluster de filas (pt). */
const ROW_CLUSTER_GAP = 10

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
): RawTable {
  const columns: RawColumn[] = []
  const columnTokens: Array<Set<string>> = []
  const seenTokens = new Set<string>()
  const rows: RawRow[] = []
  const cells: RawCell[] = []
  let lastRowIndex = -1

  for (const pageNumber of located.pages) {
    const page = byPage.get(pageNumber)
    if (!page) continue

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

    // --- Encabezado: banda de texto con más fichas de visita.
    const bands = textBands(page.items)
    let headerItems: TextItem[] = []
    let headerHits = 0
    for (const band of bands) {
      const hits = band.items.filter((i) => VISIT_TOKEN.test(i.str.trim())).length
      if (hits > headerHits) {
        headerHits = hits
        headerItems = band.items
      }
    }

    // --- Bandas de columna efectivas: los bordes V no siempre llegan por
    // columna (F1 T2 y F5 T1 dejan zonas sin bordes intermedios), así que una
    // banda-x que contiene varias fichas del encabezado se SUBDIVIDE por
    // ficha: los cortes son los puntos medios entre fichas adyacentes.
    const effBands: Array<[number, number]> = []
    const effTokens: TextItem[][] = []
    for (const band of bandsX) {
      const tokens = headerItems
        .filter((item) => center(item) >= band[0] && center(item) <= band[1])
        .sort((a, b) => a.bbox[0] - b.bbox[0])
      if (tokens.length <= 1) {
        effBands.push(band)
        effTokens.push(tokens)
        continue
      }
      for (let k = 0; k < tokens.length; k++) {
        const cx = center(tokens[k]!)
        const left = k === 0 ? band[0] : (center(tokens[k - 1]!) + cx) / 2
        const right = k === tokens.length - 1 ? band[1] : (cx + center(tokens[k + 1]!)) / 2
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
      localColumns.push({ band, token: tokens[0]!.str.trim() })
      if (tokens.some((t) => !tokensBeforePage.has(t.str.trim()))) {
        const box = boxOf(tokens)!
        for (const t of tokens) seenTokens.add(t.str.trim())
        columns.push({
          index: columns.length,
          page: pageNumber,
          xCenter: (band[0] + band[1]) / 2,
          x0: band[0],
          x1: band[1],
          headerText: tokens.map((t) => t.str.trim()).join(' '),
          headerBBox: box,
        })
        columnTokens.push(new Set(tokens.map((t) => t.str.trim())))
      }
    }

    // Zona de etiquetas: a la izquierda de la primera banda-x con ficha.
    const firstColumnX = localColumns[0]?.band[0] ?? Infinity
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
    if (headerCeiling === -Infinity && headerItems.length > 0) {
      headerCeiling = Math.max(...headerItems.map((i) => i.bbox[3]))
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

    // --- RawRow por banda (de arriba a abajo = orden de lectura).
    for (const [bandIdx, band] of rowBands.entries()) {
      const label = band.labelItems.map((i) => i.str.trim()).join(' ')
      const continued =
        bandIdx === 0 &&
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

    // --- Celdas: cada marca cae en una columna (centro-x) y una fila (base de caja).
    for (const mark of marks) {
      const colIdx = effBands.findIndex(
        ([x0, x1]) => center(mark) >= x0 - 0.5 && center(mark) <= x1 + 0.5,
      )
      const rowIdx = rowBands.findIndex(
        (band) => mark.bbox[1] >= band.y0 - 0.5 && mark.bbox[1] <= band.y1 + 0.5,
      )
      // Solo marcas dentro de la grilla: banda de columna (con ficha de
      // encabezado) y banda-y de fila. Las que quedan fuera las reporta G3.
      // Las marcas de una fila de atributo ("Ayuno"…, ADR-10 §2.2 b) no son
      // celdas del cronograma: la fila se entrega marcada y P3 decide.
      if (colIdx < 0 || rowIdx < 0) continue
      if (rowBands[rowIdx]!.isAttribute) continue
      if (!localColumns.some((lc) => lc.band === effBands[colIdx])) continue

      // Índice de columna de la tabla: ficha de la banda local → columna
      // registrada con esa ficha; con fichas repetidas (los "—" de F3), la
      // posición ordinal entre las candidatas; sin ficha, la ordinal local.
      const local = localColumns.findIndex((lc) => lc.band === effBands[colIdx])
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
      if (tableCol < 0) tableCol = local >= 0 ? local : colIdx

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
    }
  }

  return {
    key: located.key,
    pages: [...located.pages],
    columns,
    rows,
    cells,
    windowRow: null,
    notes: [],
    checks: [],
    outcome: 'partial',
    reasons: ['checks_pending'],
  }
}

/**
 * Etapa (b): la grilla cruda de cada tabla localizada. Determinista y puro;
 * sin tope de 30 páginas (D2) — se lee todo lo localizado.
 */
export function readGrid(pages: PageGeom[], location: ScheduleLocation): RawSchedule {
  const byPage = new Map(pages.map((p) => [p.page, p]))
  return {
    tables: location.tables.map((table) => readTable(table, byPage)),
    location,
  }
}
