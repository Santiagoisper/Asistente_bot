/**
 * @ichtys/soa — lectura geométrica del cronograma (SoA), ADR-10 P2.
 *
 * Etapas de P2 (sin modelo ni claves):
 *   (a) `locateSchedule` — localiza las páginas del cronograma (locate.ts);
 *   (b) `readGrid` — grilla cruda por tabla con chequeos G1–G7, llamadas de
 *       nota y outcome (grid.ts).
 */
export { loadPageGeometry, PdfLimitError } from './pdf-text'
export type { PdfLimitCode } from './pdf-text'
export { locateSchedule } from './locate'
export { columnCenterCollisions, readGrid } from './grid'
export type {
  BBox,
  HeaderSource,
  PageGeom,
  RawCell,
  RawColumn,
  RawRow,
  RawSchedule,
  RawTable,
  RuleLine,
  ScheduleLocation,
  TextItem,
} from './types'
