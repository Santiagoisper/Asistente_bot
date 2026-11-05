/**
 * P2b (b) — precisión del localizador + K1 (nada desaparece en silencio).
 *
 * Medición privada: el localizador emitía 15–28 «tablas» candidatas por
 * documento y 14–27 salían `failed/grid_unreadable` (páginas que no son
 * cronograma con bordes y alguna «X»). Fail-closed funcionaba; la
 * precisión no. Una racha de páginas sin NINGÚN encabezado (con prefijo o
 * numérico) y sin densidad de marcas se descarta con razón explícita en
 * `rejected` — nunca en silencio.
 *
 * K1 (G12): una racha CON encabezado NUNCA se descarta. Las marcas se
 * reconocen con un conjunto fijo de glifos y un cronograma real marcado con
 * otro símbolo queda con encabezado y 0 marcas reconocidas — descartarlo
 * sería la pérdida silenciosa que P2 cierra. Se conserva y la lectura la
 * marca `failed` con 'no_marks'; la tabla de abreviaturas con fichas V1…
 * que motivó el descarte antiguo queda igual (ruido honesto, visible). Una
 * racha DENSA sin encabezado reconocible tampoco se descarta: sigue siendo
 * tabla y sale `failed`.
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

describe('P2b (b) — rachas sin encabezado se descartan con razón; con encabezado nunca (K1)', () => {
  const pages = documentWithNoise()
  const location = locateSchedule(pages)
  const rejected = new Map(location.rejected.map((r) => [r.page, r.reason]))

  it('la tabla real queda como T1 y el ruido SIN encabezado no es tabla', () => {
    expect(location.tables[0]).toMatchObject({ key: 'T1', pages: [1, 2, 3, 4] })
    expect(location.tables.some((t) => t.pages.includes(6))).toBe(false)
  })

  it('el descarte explícito es solo para rachas sin encabezado; la de abreviaturas (con fichas V1…) ya no se descarta (K1)', () => {
    expect(rejected.get(6)).toBe('no_header')
    expect(rejected.has(8)).toBe(false)
  })

  it('la tabla de abreviaturas (encabezado V1…, sin marcas) queda como tabla failed/no_marks: ruido honesto, no pérdida (K1)', () => {
    const abbreviations = location.tables.find((t) => t.pages.includes(8))
    expect(abbreviations).toBeDefined()
    const schedule = readGrid(pages, location)
    const table = schedule.tables.find((t) => t.pages.includes(8))!
    expect(table.outcome).toBe('failed')
    expect(table.reasons).toContain('no_marks')
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

  it('las claves de tabla quedan contiguas tras el descarte (T1, T2, T3)', () => {
    expect(location.tables.map((t) => t.key)).toEqual(['T1', 'T2', 'T3'])
  })

  it('el localizador es determinista: misma entrada, misma salida', () => {
    expect(locateSchedule(pages)).toEqual(location)
  })
})

describe('K1 — un glifo de marca fuera del conjunto reconocido no borra la tabla', () => {
  it('marcas «○» (glifo de los tableros reales, fuera del conjunto viejo): tabla presente y leída', () => {
    const { pages } = build({
      header: { label: 'Número de visita', values: NUMERIC_VALUES },
      rowsPerPage: [3, 3],
      markGlyph: '○',
    })
    const location = locateSchedule(pages)
    // Nunca solo en rejected: la tabla existe…
    expect(location.tables).toHaveLength(1)
    expect(location.rejected).toHaveLength(0)
    // …y sus marcas se leen como celdas.
    const table = readGrid(pages, location).tables[0]!
    expect(table.outcome).not.toBe('failed')
    expect(table.reasons).not.toContain('no_marks')
    expect(table.cells.some((c) => c.text === '○')).toBe(true)
    expect(table.checks.find((c) => c.id === 'G3')?.pass).toBe(true)
  })

  it('marcas con un glifo que ni el conjunto nuevo reconoce («◆»): tabla presente y failed/no_marks, no rechazada', () => {
    const { pages } = build({
      header: { label: 'Número de visita', values: NUMERIC_VALUES },
      rowsPerPage: [3, 3],
      markGlyph: '◆',
    })
    const location = locateSchedule(pages)
    expect(location.tables).toHaveLength(1)
    expect(location.rejected).toHaveLength(0)
    const table = readGrid(pages, location).tables[0]!
    expect(table.outcome).toBe('failed')
    expect(table.reasons).toContain('no_marks')
  })
})
