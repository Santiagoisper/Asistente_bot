/**
 * G18 §1 — el techo de una región cubre TODO el bloque del encabezado de su
 * tira (fichas, letras y ETIQUETA), y la primera región sube hasta el techo
 * de la página.
 *
 * Regresión del protocolo difícil introducida por C1b (12732a9, medida
 * privada G18): la etiqueta de la fila de enteros vive ~11 pt POR ENCIMA de
 * las fichas; con el techo de la región en las fichas, la etiqueta quedaba
 * fuera de la franja y findNumericHeader — que exige etiqueta (P2b) — no
 * veía encabezado DENTRO de la región: 0 columnas, failed/grid_unreadable
 * (8dc92cd daba partial con 19 columnas; 12732a9/9e60980/f9e686c daban 0).
 *
 * Variante sintética del F6 pedido en G18 §3: 19 fichas (16 enteros y 3
 * guiones, tras el 4, el 6 y el 7), etiqueta elevada, fila de tiempo con su
 * etiqueta propia («Semanas desde…», que no es etiqueta de tira) debajo,
 * más de una página.
 */
import { describe, expect, it } from 'vitest'
import { locateSchedule, readGrid } from '../index'
import { build } from './synthetic-pages'

describe('G18 — el techo de la región cubre el bloque completo del encabezado', () => {
  const VALUES: Array<number | null> = [1, 2, 3, 4, null, 5, 6, null, 7, null, 8, 9, 10, 11, 12, 13, 14, 15, 16]

  const doc = build({
    header: { label: 'Número de visita', values: VALUES },
    rowsPerPage: [3, 3],
    commentsHeader: false,
    timeRow: { label: 'Semanas desde aleatorización', values: [1, 8, 15, 22, 29, 36] },
    labelOffsetY: 11,
  })

  it('la etiqueta 11 pt por encima de las fichas no se pierde: 19 columnas, nunca 0', () => {
    const table = readGrid(doc.pages, locateSchedule(doc.pages)).tables[0]!
    // Nunca 0 (la regresión): la tabla de la variante F6 sale con sus 19
    // columnas registradas, no failed/grid_unreadable.
    expect(table.columns).toHaveLength(19)
    expect(table.columns.map((c) => c.headerText)).toEqual(
      VALUES.map((v) => (v === null ? '-' : String(v))),
    )
    expect(table.outcome).toBe('partial')
    expect(table.reasons).toContain('truncated_pages')
  })
})
