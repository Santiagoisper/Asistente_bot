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

/** Tabla cruda con sus chequeos geométricos (§4). */
export interface RawTable {
  key: string
  pages: number[]
  columns: RawColumn[]
  rows: RawRow[]
  cells: RawCell[]
  windowRow: { rowIndex: number; cells: RawCell[] } | null
  notes: Array<{ ref: string; page: number; text: string; bbox: BBox }>
  checks: Array<{ id: string; pass: boolean; detail: string }>
  outcome: 'complete' | 'partial' | 'failed'
  reasons: string[]
}

/** Salida completa de la etapa (b). */
export interface RawSchedule {
  tables: RawTable[]
  location: ScheduleLocation
}

/** Contrato de salida de la normalización (P3, ADR-10 §3). */
export type { Schedule, Condition } from './schedule-contract'
