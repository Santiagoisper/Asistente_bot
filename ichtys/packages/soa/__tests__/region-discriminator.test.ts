/**
 * G18 §3.1/§4 — regiones solo con discriminador: el corte por regiones de
 * C1b (una región por tira de encabezado) se activa SOLO si entre dos
 * líneas de encabezado hay filas de datos con MARCAS. Sin marcas entre
 * ambas, las tiras son filas del MISMO bloque de encabezado y la página es
 * una sola región: la tira de eje temporal («Semanas») bajo la de visitas
 * no crea columnas propias (visitOnly dentro de la región).
 *
 * Caso F8 (control, CON marcas entre las tiras): dos tablas apiladas de
 * verdad — la de abajo conserva su encabezado de semanas como tira propia
 * (regiones separadas). Hoy el filtro visitOnly de findNumericHeaders la
 * elimina ANTES de que el discriminador la vea: sus columnas no existen y
 * las marcas de esa tabla caen en las columnas de la de arriba.
 */
import { describe, expect, it } from 'vitest'
import { locateSchedule, readGrid } from '../index'
import { build, centered, NUMERIC_VALUES } from './synthetic-pages'

const spec = () => ({
  header: { label: 'Número de visita', values: NUMERIC_VALUES },
  rowsPerPage: [3],
  timeRow: { label: 'Semanas', values: [1, 8, 15, 22, 29, 36] },
})

describe('G18 §4 — regiones solo con discriminador de marcas', () => {
  it('sin marcas entre las tiras: un bloque, las semanas no son columnas', () => {
    const { pages } = build(spec())
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!

    expect(table.columns).toHaveLength(18)
    expect(table.columns.every((c) => c.headerSource === 'numeric_visit')).toBe(true)
  })

  it('con marcas entre las tiras (F8): la tabla de abajo conserva su encabezado', () => {
    const { pages } = build(spec())
    // Una marca de la última fila de la tabla de ARRIBA, en la franja entre
    // la tira de visitas (piso ≈506) y el bloque de la de semanas (≈492).
    // A y=508: su caja [501,508] queda FUERA de la franja de letras de la
    // tira de abajo (top+2..top+15 = 494..507) — dentro de esa franja la
    // marca sería letra de la ficha partida, no fila de datos.
    pages[0]!.items.push(centered(1, 'X', 170 + 17, 508, 7))
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!

    // 18 de visitas + las fichas de semanas NUEVAS (22, 29, 36): la tira de
    // semanas vuelve a ser tira propia y sus columnas son numeric_time (K2).
    expect(table.columns).toHaveLength(21)
    const timeCols = table.columns.filter((c) => c.headerSource === 'numeric_time')
    expect(timeCols.map((c) => c.headerText)).toEqual(['22', '29', '36'])
  })
})
