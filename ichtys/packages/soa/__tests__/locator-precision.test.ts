/**
 * P2b (b) — precisión del localizador.
 *
 * Medición privada: el localizador emitía 15–28 «tablas» candidatas por
 * documento y 14–27 salían `failed/grid_unreadable` (páginas que no son
 * cronograma con bordes y alguna «X»). Fail-closed funcionaba; la
 * precisión no. Ahora una racha de páginas sin NINGÚN encabezado (con
 * prefijo o numérico) y sin densidad de marcas se descarta con razón
 * explícita en `rejected` — nunca en silencio. Una racha densa sin
 * encabezado reconocible NO se descarta: sigue siendo tabla y sale `failed`
 * (una tabla real ilegible tiene que verse, no desaparecer).
 */
import { describe, expect, it } from 'vitest'
import { locateSchedule, readGrid } from '../index'
import type { PageGeom } from '../types'
import { blankPage, build, NUMERIC_VALUES } from './synthetic-pages'

/** Documento: tabla real (p1–4) + ruido separado por páginas en blanco. */
function documentWithNoise(): PageGeom[] {
  const real = build({
    header: { label: 'Número de visita', values: NUMERIC_VALUES },
    rowsPerPage: [4, 2, 6, 3],
  }).pages
  // Ruido 1: tabla con bordes, 3 «X» y sin encabezado (p. ej. criterios con tildes).
  const sparse = build({ header: { label: null, values: [1, 2, 3] }, rowsPerPage: [1], firstPage: 6 }).pages
  // Ruido 2: tabla de abreviaturas con fichas V1…V4 pero sin una sola marca.
  const abbreviations = build({
    header: { label: null, values: ['V1', 'V2', 'V3', 'V4'] },
    rowsPerPage: [2],
    firstPage: 8,
    withMarks: false,
    commentsHeader: false,
  }).pages
  // Racha DENSA con una etiqueta que no reconozco: tabla real ilegible.
  const dense = build({
    header: { label: 'Peso (kg)', values: NUMERIC_VALUES },
    rowsPerPage: [4, 3],
    firstPage: 10,
  }).pages
  return [...real, blankPage(5), ...sparse, blankPage(7), ...abbreviations, blankPage(9), ...dense]
}

describe('P2b (b) — rachas sin encabezado se descartan con razón, las densas no', () => {
  const pages = documentWithNoise()
  const location = locateSchedule(pages)
  const rejected = new Map(location.rejected.map((r) => [r.page, r.reason]))

  it('la tabla real queda como T1 y el ruido sin encabezado no es tabla', () => {
    expect(location.tables[0]).toMatchObject({ key: 'T1', pages: [1, 2, 3, 4] })
    for (const noisePage of [6, 8]) {
      expect(location.tables.some((t) => t.pages.includes(noisePage)), `p${noisePage}`).toBe(false)
    }
  })

  it('el descarte es explícito: no_header (sin encabezado ni densidad) y low_density (encabezado pero sin marcas)', () => {
    expect(rejected.get(6)).toBe('no_header')
    expect(rejected.get(8)).toBe('low_density')
  })

  it('una racha densa sin encabezado reconocible NO desaparece: sigue siendo tabla y sale failed', () => {
    const dense = location.tables.find((t) => t.pages.includes(10))
    expect(dense).toBeDefined()
    expect(dense!.pages).toEqual([10, 11])
    expect(rejected.has(10)).toBe(false)
    const schedule = readGrid(pages, location)
    const table = schedule.tables.find((t) => t.pages.includes(10))!
    expect(table.outcome).toBe('failed')
    expect(table.reasons).toContain('grid_unreadable')
  })

  it('las claves de tabla quedan contiguas tras el descarte (T1, T2…)', () => {
    expect(location.tables.map((t) => t.key)).toEqual(['T1', 'T2'])
  })

  it('el localizador es determinista: misma entrada, misma salida', () => {
    expect(locateSchedule(pages)).toEqual(location)
  })
})
