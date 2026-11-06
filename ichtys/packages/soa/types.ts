/**
 * types.ts — contratos de P2 (orden B-P2 §2, ADR-10 §2.2 etapas a y b).
 *
 * Todo lo que produce este paquete es GEOMETRÍA determinista: páginas, cajas
 * y texto del documento. Sin modelo, sin clave, sin red.
 *
 * `label`, `text` y `headerText` son texto del documento: se devuelven al
 * llamador pero NUNCA se loguean (S8).
 */

/** Caja en puntos PDF, origen abajo-izquierda, espacio de usuario SIN rotar (igual que el gold). */
export type BBox = [x0: number, y0: number, x1: number, y1: number]

/** Un ítem de texto con su caja y su tamaño de fuente efectivo. */
export interface TextItem {
  page: number
  str: string
  bbox: BBox
  fontSize: number
  /**
   * El texto NO está en el eje horizontal: el transform trae b/c ≠ 0
   * (rotado o skew). El lector no extrae contenido de estos ítems — quedan
   * reportados para que G6 pueda señalar pérdida (reason 'rotated_text').
   */
  rotated: boolean
}

/** Segmento de borde de tabla (horizontal o vertical), en espacio de usuario sin rotar. */
export interface RuleLine {
  page: number
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Geometría completa de una página. */
export interface PageGeom {
  page: number
  width: number
  height: number
  rotate: 0 | 90 | 180 | 270
  items: TextItem[]
  rules: RuleLine[]
}

/** Resultado de la etapa (a): qué páginas son cronograma y cuáles se descartan. */
export interface ScheduleLocation {
  /** Todas las páginas con score > 0, con sus señales, para auditar. */
  candidates: Array<{ page: number; score: number; signals: Record<string, number> }>
  tables: Array<{
    key: string
    pages: number[]
    notePages: number[]
    headerSignature: string[]
    /**
     * De dónde salió el encabezado de la tabla (K2): 'none' si ninguna página
     * de la racha tuvo encabezado reconocible (racha densa conservada).
     */
    headerKind: HeaderSource | 'none'
  }>
  rejected: Array<{
    page: number
    reason: 'toc' | 'list_of_tables' | 'synopsis_prose' | 'low_density' | 'no_header'
  }>
}

/**
 * De dónde salió el encabezado de una columna (K2, G12):
 * - 'prefixed' — fichas con prefijo (V1, S3, W12…): el texto ES el id impreso;
 * - 'numeric_visit' — fila etiquetada «Número de visita» + enteros: el entero
 *   es número de visita;
 * - 'numeric_time' — fila etiquetada «Día»/«Semana» + enteros: el entero es
 *   TIEMPO. Contrato para P3: un entero numeric_time va a `timing`, NUNCA a
 *   `printedId` — tomarlo por id de visita sería un id inventado (R3, ADR-10 §0).
 */
export type HeaderSource = 'prefixed' | 'numeric_visit' | 'numeric_time'

/** Columna cruda detectada por geometría. */
export interface RawColumn {
  index: number
  page: number
  xCenter: number
  x0: number
  x1: number
  headerText: string
  headerBBox: BBox
  headerSource: HeaderSource
  /**
   * C2 (P2c): sin contenido en NINGUNA página (mismo criterio de contenido
   * que G1: celdas fuera de la fila de ventana). La columna NO se descarta
   * (K1): la ficha queda y P3 la ve vacía; G1 baja la tabla a 'partial'.
   */
  empty: boolean
  /**
   * G18 §3.2: fichas de TIEMPO (S…, W…, D…) de la fila bajo el encabezado
   * de ids, proyectadas por x sobre esta columna (orden x, texto crudo,
   * unidas con espacio). '' si la tabla no tiene fila de tiempo. El tiempo
   * NUNCA es id de visita (K2): P3 lo lleva a `timing`.
   */
  timingText: string
}

/** Fila cruda detectada por geometría. */
export interface RawRow {
  index: number
  page: number
  label: string
  labelBBox: BBox
  y0: number
  y1: number
  continuedFromPrevPage: boolean
  isAttributeCandidate: boolean
}

/** Celda cruda. `distanceToCenter` es 0..1 sobre el ancho de la columna. */
export interface RawCell {
  page: number
  rowIndex: number
  colIndex: number
  text: string
  bbox: BBox
  kind: 'mark' | 'text' | 'merged'
  spanCols: number[]
  noteRefs: string[]
  distanceToCenter: number
}

/**
 * Marca de una fila de atributo (Ayuno, visita a la clínica…). No es una
 * celda: T5 sigue en 0 celdas de atributo. El texto es del documento y no
 * se loguea (S8).
 */
export interface AttributeMark {
  rowIndex: number
  colIndex: number
  page: number
  bbox: BBox
  text: string
}

/** Tabla cruda con sus chequeos geométricos (§4). */
export interface RawTable {
  key: string
  pages: number[]
  columns: RawColumn[]
  rows: RawRow[]
  cells: RawCell[]
  /**
   * Marcas de filas de atributo, aparte de `cells` (G26). `marksAttr` las
   * contaba y las tiraba; ahora viajan acá.
   */
  attributeMarks: AttributeMark[]
  windowRow: { rowIndex: number; cells: RawCell[] } | null
  notes: Array<{ ref: string; page: number; text: string; bbox: BBox }>
  checks: Array<{ id: string; pass: boolean; detail: string }>
  outcome: 'complete' | 'partial' | 'failed'
  reasons: string[]
}

/**
 * Párrafo de reglas previo a la grilla (G26). Texto del protocolo: dato,
 * nunca a logs (S8).
 */
export interface RuleParagraph {
  index: number
  page: number
  text: string
}

/** Salida completa de la etapa (b). */
export interface RawSchedule {
  tables: RawTable[]
  location: ScheduleLocation
  /**
   * Prosa de las páginas `synopsis_prose` anteriores a la primera tabla,
   * más el texto de esa página que queda por encima del encabezado.
   * Tope de páginas y de caracteres en `collectRuleParagraphs`.
   */
  ruleParagraphs: RuleParagraph[]
}
