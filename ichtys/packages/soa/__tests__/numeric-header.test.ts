/**
 * P2b (a) — encabezado numérico sin prefijo.
 *
 * Medición privada sobre protocolos reales: el encabezado de visitas es una
 * fila con ETIQUETA ("Número de visita") seguida de ENTEROS sin prefijo
 * (1, 2, 3 … 16) donde un guion es una columna sin número, repetida en cada
 * página. El detector solo reconocía fichas con prefijo (V#, S#, Semana…) y
 * el protocolo más difícil daba 0 columnas.
 *
 * Geometría SINTÉTICA en memoria (los fixtures no se tocan) con la estructura
 * del F6 que arma Grok: páginas apaisadas, banda de períodos agrupados sobre
 * el encabezado, tira de comentarios a la derecha, 2–6 filas por página.
 *
 * Guardas negativas: una fila de enteros SIN etiqueta es dato, no
 * encabezado; una fila "Día" no le quita el encabezado a las fichas con
 * prefijo ni a la fila "Número de visita".
 */
import { describe, expect, it } from 'vitest'
import { locateSchedule, readGrid } from '../index'
import type { PageGeom, RawTable } from '../types'
import { build, NUMERIC_VALUES } from './synthetic-pages'

const tableOf = (pages: PageGeom[]): RawTable => readGrid(pages, locateSchedule(pages)).tables[0]!

describe('P2b (a) — encabezado numérico: etiqueta de fila + enteros con guiones', () => {
  const { pages, marks } = build({
    header: { label: 'Número de visita', values: NUMERIC_VALUES },
    rowsPerPage: [4, 2, 6, 3],
  })

  it('el localizador agrupa las 4 páginas en una tabla y reporta la firma numérica', () => {
    const location = locateSchedule(pages)
    expect(location.tables).toHaveLength(1)
    expect(location.tables[0]!.pages).toEqual([1, 2, 3, 4])
    // La firma del encabezado trae las fichas (enteros y guiones), no queda vacía.
    expect(location.tables[0]!.headerSignature).toEqual(expect.arrayContaining(['1', '16', '—']))
  })

  it('lee una columna por entero y por guion, en orden, sin convertir la etiqueta en columna', () => {
    const table = tableOf(pages)
    expect(table.outcome).not.toBe('failed')
    expect(table.columns).toHaveLength(NUMERIC_VALUES.length)
    expect(table.columns.map((c) => c.headerText)).toEqual(
      NUMERIC_VALUES.map((v) => (v === null ? '-' : String(v))),
    )
    // Orden de lectura: los centros crecen y la tira de comentarios no es columna.
    const centers = table.columns.map((c) => c.xCenter)
    expect(centers).toEqual([...centers].sort((a, b) => a - b))
    expect(table.columns.every((c) => c.page === 1)).toBe(true)
  })

  it('cada marca tiene dueño: celdas = marcas dibujadas y G3 en pass; las columnas sin número reciben sus marcas', () => {
    const table = tableOf(pages)
    expect(table.cells.filter((c) => c.kind === 'mark')).toHaveLength(marks)
    expect(table.checks.find((c) => c.id === 'G3')?.pass).toBe(true)
    // Los dos guiones son columnas distintas y ambas reciben marcas.
    for (const dashIndex of [3, 9]) {
      expect(table.cells.some((c) => c.colIndex === dashIndex), `columna ${dashIndex}`).toBe(true)
    }
  })

  it('el encabezado repetido no duplica columnas y las filas son las del cuerpo (2–6 por página)', () => {
    const table = tableOf(pages)
    const perPage = [4, 2, 6, 3]
    for (const [i, n] of perPage.entries()) {
      expect(table.rows.filter((r) => r.page === i + 1)).toHaveLength(n)
    }
  })
})

describe('P2b (a) — guardas negativas', () => {
  it('una fila de enteros SIN etiqueta no es encabezado: la tabla no se lee como grilla', () => {
    const { pages } = build({
      header: { label: null, values: NUMERIC_VALUES },
      rowsPerPage: [4, 3],
    })
    const table = tableOf(pages)
    expect(table.columns).toHaveLength(0)
    expect(table.outcome).toBe('failed')
  })

  it('una etiqueta que no es de encabezado ("Peso (kg)") tampoco habilita la fila', () => {
    const { pages } = build({
      header: { label: 'Peso (kg)', values: NUMERIC_VALUES },
      rowsPerPage: [4, 3],
    })
    expect(tableOf(pages).columns).toHaveLength(0)
  })

  it('una fila "Día" con enteros bajo fichas con prefijo no le quita el encabezado', () => {
    const prefixed = Array.from({ length: 6 }, (_, i) => `V${i + 1}`)
    const { pages } = build({
      header: { label: null, values: prefixed },
      rowsPerPage: [3, 3],
      timeRow: { label: 'Día', values: [1, 8, 15, 22, 29, 36] },
      commentsHeader: false,
    })
    const table = tableOf(pages)
    expect(table.columns.map((c) => c.headerText)).toEqual(prefixed)
  })

  it('"Número de visita" gana a "Día" aunque la fila de días vaya más arriba en la página', () => {
    // El encabezado de visitas es la fila "Número de visita"; la de días está
    // debajo (la banda del tiempo) y tiene enteros crecientes también.
    const values = [1, 2, 3, 4, 5, 6]
    const { pages } = build({
      header: { label: 'Número de visita', values },
      rowsPerPage: [3, 3],
      timeRow: { label: 'Día', values: [1, 8, 15, 22, 29, 36] },
    })
    const table = tableOf(pages)
    expect(table.columns.map((c) => c.headerText)).toEqual(values.map(String))
  })

  it('una fila "Día" sola, con enteros crecientes y sin fichas con prefijo, sí sirve de encabezado', () => {
    const { pages } = build({
      header: { label: 'Día', values: [1, 8, 15, 22, 29] },
      rowsPerPage: [4, 4],
    })
    expect(tableOf(pages).columns.map((c) => c.headerText)).toEqual(['1', '8', '15', '22', '29'])
  })

  it('enteros que no crecen de izquierda a derecha no son encabezado, aunque tengan etiqueta', () => {
    const { pages } = build({
      header: { label: 'Número de visita', values: [3, 1, 2, 5, 4] },
      rowsPerPage: [4, 4],
    })
    expect(tableOf(pages).columns).toHaveLength(0)
  })
})
