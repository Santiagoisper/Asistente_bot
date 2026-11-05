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
  BBox,
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

/** Texto de celda de rango ("según necesidad" y variantes). */
const PRN_RE = /(según necesidad|as needed|a demanda|si aplica|p\.?r\.?n\.?)/

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
  return text.replace(/\s+/g, '')
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
): RawTable {
  const columns: RawColumn[] = []
  const columnTokens: Array<Set<string>> = []
  const seenTokens = new Set<string>()
  const rows: RawRow[] = []
  const cells: RawCell[] = []
  let windowRow: { rowIndex: number; cells: RawCell[] } | null = null
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

    // --- Encabezado: bandas de texto con más fichas de visita, MÁS las
    // pegadas (±8 pt): una ficha partida por el extractor ("V" / "12" en dos
    // líneas) cae en dos bandas por el techo de sus cajas. Los ítems se
    // recomponen por adyacencia x (groupTexts), así la ficha vuelve a ser un
    // solo texto.
    const bands = textBands(page.items)
    let headerY = 0
    let headerHits = 0
    for (const band of bands) {
      const hits = band.items.filter((i) => VISIT_TOKEN.test(i.str.trim())).length
      if (hits > headerHits) {
        headerHits = hits
        headerY = band.y
      }
    }
    const headerGroups = groupTexts(
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
        })
        columnTokens.push(new Set(norm))
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
  }

  return {
    key: located.key,
    pages: [...located.pages],
    columns,
    rows,
    cells,
    windowRow,
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
