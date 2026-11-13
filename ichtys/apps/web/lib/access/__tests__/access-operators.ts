/**
 * Operadores de condición inspeccionables para el fixture de «Equipo y
 * accesos». Viven en un archivo aparte, sin dependencias: los mocks hoisted
 * de vi.mock los importan dinámicamente y no pueden usar variables del test.
 *
 * Misma forma que los de drizzle-orm (misma firma, mismos nombres) pero su
 * estructura se puede leer: el `where()` del fixture los evalúa contra las
 * filas de prueba en vez de armar SQL.
 */

export type Cond =
  | { kind: 'eq'; column: unknown; value: unknown }
  | { kind: 'and'; conds: Cond[] }
  | { kind: 'or'; conds: Cond[] }
  | { kind: 'isNull'; column: unknown }
  | { kind: 'isNotNull'; column: unknown }
  | { kind: 'gt'; column: unknown; value: unknown }

export const eq = (column: unknown, value: unknown): Cond => ({ kind: 'eq', column, value })
export const and = (...conds: Cond[]): Cond => ({ kind: 'and', conds })
export const or = (...conds: Cond[]): Cond => ({ kind: 'or', conds })
export const isNull = (column: unknown): Cond => ({ kind: 'isNull', column })
export const isNotNull = (column: unknown): Cond => ({ kind: 'isNotNull', column })
export const gt = (column: unknown, value: unknown): Cond => ({ kind: 'gt', column, value })
