/**
 * @ichtys/soa — lectura geométrica del cronograma (SoA), ADR-10 P2.
 *
 * Etapas de P2 (sin modelo ni claves):
 *   (a) `locateSchedule` — localiza las páginas del cronograma (locate.ts);
 *   (b) `readGrid` — arma la grilla cruda por tabla (grid.ts).
 *
 * Este archivo crece con cada commit de P2; hoy expone la capa de PDF y los
 * contratos. `locateSchedule` y `readGrid` se agregan con sus commits.
 */
export { loadPageGeometry } from './pdf-text'
export type { BBox, PageGeom, RuleLine, TextItem } from './types'
