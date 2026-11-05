/**
 * F9 en el PDF, no solo en el gold. La forma es la de G22 §3: etiqueta de
 * 6 letras en la línea de fichas, 10 enteros, 4 fichas con letras (una
 * partida en dos palabras) y una leyenda larga. El corte viejo se quedaba
 * con las fichas de id y tiraba los enteros. La ventana no cubre la
 * etiqueta: si esa etiqueta volviera a ser columna, G2 dejaría de cubrir.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadPageGeometry, locateSchedule, readGrid } from '../index'

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/soa/', import.meta.url))
const EXPECTED = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  'ET', 'FA', 'EOS', 'Fin etapa', 'Anotacion larga de las fichas',
] as const

describe('F9 — el lector conserva el encabezado mixto', () => {
  const pdf = new Uint8Array(readFileSync(`${FIXTURES_DIR}F9.pdf`))

  it('15 columnas, la etiqueta no es columna, y las marcas no se pierden', async () => {
    const pages = await loadPageGeometry(pdf)
    const location = locateSchedule(pages)
    const table = readGrid(pages, location).tables[0]!
    expect(location.tables[0]!.pages).toEqual([2, 3])
    expect(table.columns.map((column) => column.headerText)).toEqual([...EXPECTED])
    expect(table.columns.some((column) => column.headerText.includes('Visita'))).toBe(false)
    const assigned = table.cells.filter((cell) => cell.kind === 'mark').length
    const g2 = table.checks.find((check) => check.id === 'G2')!
    const g3 = table.checks.find((check) => check.id === 'G3')!
    expect(g2.detail).not.toBe('sin fila de ventana')
    expect(g3.pass).toBe(true)
    expect(assigned).toBe(45)
    expect(g2.pass && assigned < 45).toBe(false)
  })
})
