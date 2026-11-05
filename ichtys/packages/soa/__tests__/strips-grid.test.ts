/**
 * P2c C1b — la LECTURA por tira: columnas de cada tira y filas colgando de
 * SU tira.
 *
 * C1a hizo que locate VEA las fichas de las dos tiras; el lector seguía
 * procesando UNA franja por página: las marcas de la tira de abajo caían en
 * las bandas-x de la de arriba (misma grilla x) y se asignaban a las
 * columnas de la tira equivocada — el mecanismo de la sobrelectura del
 * protocolo difícil. Acá cada tira es una región con su franja vertical: sus
 * filas cuelgan de ELLA y sus marcas van a SUS columnas.
 *
 * ROJO esperado contra C1a: readGrid registra solo las columnas de la
 * primera tira (8 de 16) y las marcas de la segunda terminan asignadas a
 * las columnas de la primera.
 */
import { describe, expect, it } from 'vitest'
import { locateSchedule, readGrid } from '../index'
import { buildStrips } from './synthetic-pages'

const CHIPS_A = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8']
const CHIPS_B = ['V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16']
const ALL_CHIPS = [...CHIPS_A, ...CHIPS_B]

const DOC = {
  strips: [
    { label: 'Número de visita', chips: CHIPS_A },
    { label: 'Número de visita', chips: CHIPS_B },
  ],
  rowsPerPage: [3, 3],
}

describe('P2c C1b — readGrid por tira: cada fila cuelga de SU encabezado', () => {
  const { pages, marks } = buildStrips(DOC)

  it('las DOS tiras registran sus columnas: 16, con la ficha compuesta', () => {
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!
    expect(table.columns).toHaveLength(ALL_CHIPS.length)
    // Orden de registro: tira de arriba primero, luego la de abajo.
    expect(table.columns.slice(0, 8).map((c) => c.headerText)).toEqual(CHIPS_A)
    expect(table.columns.slice(8).map((c) => c.headerText)).toEqual(CHIPS_B)
    expect(table.columns.every((c) => c.headerSource === 'numeric_visit')).toBe(true)
  })

  it('el encabezado repetido de la página 2 no duplica columnas', () => {
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!
    expect(table.columns).toHaveLength(ALL_CHIPS.length)
    expect(new Set(table.columns.map((c) => c.headerText)).size).toBe(ALL_CHIPS.length)
  })

  it('las filas de cada tira cuelgan de SU tira: 3 + 3 por página', () => {
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!
    expect(table.rows).toHaveLength(6 * 2)
    for (const page of [1, 2]) {
      expect(table.rows.filter((r) => r.page === page)).toHaveLength(6)
      expect(table.rows.filter((r) => r.page === page && r.label.includes('-1-'))).toHaveLength(3)
      expect(table.rows.filter((r) => r.page === page && r.label.includes('-2-'))).toHaveLength(3)
    }
    // La fila de la tira 2 está DEBAJO de su propio encabezado (y del bloque
    // completo de la tira 1): el orden de lectura es tira 1 → tira 2.
    const p1 = table.rows.filter((r) => r.page === 1)
    expect(p1.findIndex((r) => r.label.includes('-1-'))).toBeLessThan(
      p1.findIndex((r) => r.label.includes('-2-')),
    )
  })

  it('la marca de la tira 2 va a la columna de la tira 2, no a la de arriba', () => {
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!
    const strip2Cells = table.cells.filter((c) => {
      const row = table.rows[c.rowIndex]!
      return row.page === c.page && row.label.includes('-2-')
    })
    expect(strip2Cells.length).toBeGreaterThan(0)
    // Las columnas 8–15 son las de la tira de abajo: NINGUNA celda de esa
    // tira puede caer en 0–7 (la sobre-asignación de antes).
    for (const cell of strip2Cells) {
      expect(cell.colIndex, `fila «${table.rows[cell.rowIndex]!.label}»`).toBeGreaterThanOrEqual(8)
    }
    const strip1Cells = table.cells.filter((c) => {
      const row = table.rows[c.rowIndex]!
      return row.page === c.page && row.label.includes('-1-')
    })
    for (const cell of strip1Cells) {
      expect(cell.colIndex).toBeLessThan(8)
    }
  })

  it('cada marca tiene dueño y los chequeos geométricos pasan', () => {
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!
    expect(table.cells.filter((c) => c.kind === 'mark')).toHaveLength(marks)
    for (const id of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']) {
      expect(table.checks.find((c) => c.id === id)?.pass, id).toBe(true)
    }
    // El doc sintético termina en grilla (sin páginas de notas detrás), así
    // que la tabla sale 'partial' por truncated_pages — corte de documento,
    // no defecto de lectura.
    expect(table.outcome).toBe('partial')
    expect(table.reasons).toEqual(['truncated_pages'])
  })

  it('G5 sigue defendiendo su invariante: dos fichas pegadas de la MISMA tira sí colisionan', () => {
    // Las tiras comparten la grilla x (V1 sobre V9): eso NO es colisión —
    // son franjas verticales distintas. Dos fichas a <3 pt dentro de la
    // misma franja sí lo es (rama de falla en checks-negative).
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!
    const byPage = new Map<number, number[]>()
    for (const col of table.columns) byPage.set(col.page, [...(byPage.get(col.page) ?? []), col.xCenter])
    expect(byPage.get(1)).toHaveLength(ALL_CHIPS.length)
    expect(table.checks.find((c) => c.id === 'G5')?.pass).toBe(true)
  })

  it('determinista: dos lecturas iguales', () => {
    const a = readGrid(pages, locateSchedule(pages))
    const b = readGrid(pages, locateSchedule(pages))
    expect(a).toEqual(b)
  })
})
