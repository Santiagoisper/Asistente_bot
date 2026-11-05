/**
 * @ichtys/soa — lectura geométrica del cronograma (SoA), ADR-10 P2.
 *
 * Etapas de P2 (sin modelo ni claves):
 *   (a) `locateSchedule` — localiza las páginas del cronograma (locate.ts);
 *   (b) `readGrid` — arma la grilla cruda por tabla (grid.ts).
 *
 * Este archivo crece con cada commit de P2; hoy expone la capa de PDF y la
 * etapa (a). `readGrid` se agrega con su commit.
 */
export { loadPageGeometry } from './pdf-text'
export { locateSchedule } from './locate'
export { readGrid } from './grid'
export type {
  BBox,
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
