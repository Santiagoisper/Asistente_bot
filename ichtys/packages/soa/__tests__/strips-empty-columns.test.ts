/**
 * P2c C2 — columnas sin contenido MARCADAS y la etiqueta de fila no es
 * columna de visita.
 *
 * Medición privada del protocolo de 46 columnas: columnas detectadas de más
 * y columnas con ficha que no reciben ni una marca. Doctrina K1 (nada
 * desaparece en silencio): la columna vacía NO se descarta — queda en
 * columns[] MARCADA (empty), con G1 bajando la tabla a 'partial' y el índice
 * en el detail. Y la etiqueta de fila («Número de visita») es zona de
 * etiquetas, jamás la columna 0.
 */
import { describe, expect, it } from 'vitest'
import { locateSchedule, readGrid } from '../index'
import { buildStrips } from './synthetic-pages'

const CHIPS_A = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8']
const CHIPS_B = ['V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16']

const DOC = {
  strips: [
    { label: 'Número de visita', chips: CHIPS_A },
    { label: 'Número de visita', chips: CHIPS_B },
  ],
  rowsPerPage: [3, 3],
  // 'V12' (columna 11) tiene ficha en ambas páginas y jamás recibe marca.
  silentChips: ['V12'],
}

describe('P2c C2 — columna con ficha y sin contenido: marcada, no descartada', () => {
  const { pages } = buildStrips(DOC)

  it('la columna vacía queda en columns[] con empty=true; las demás false', () => {
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!
    expect(table.columns).toHaveLength(16)
    const empty = table.columns.filter((c) => c.empty)
    expect(empty.map((c) => c.headerText)).toEqual(['V12'])
    // La ficha sigue ahí (no desapareció) y el índice es el real.
    expect(table.columns[11]!.headerText).toBe('V12')
    expect(table.columns[11]!.empty).toBe(true)
    for (const c of table.columns.filter((c) => c.headerText !== 'V12')) {
      expect(c.empty, c.headerText).toBe(false)
    }
  })

  it('G1 baja la tabla a partial con la columna vacía en el detail', () => {
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!
    expect(table.outcome).toBe('partial')
    expect(table.reasons).toContain('validation_failed:G1')
    expect(table.checks.find((c) => c.id === 'G1')?.detail).toContain('c11')
  })

  it('la etiqueta de fila («Número de visita») NO es columna de visita', () => {
    const table = readGrid(pages, locateSchedule(pages)).tables[0]!
    // La primera columna es la primera FICHA de la tira de arriba, no la
    // etiqueta; ninguna columna nació de texto de etiqueta.
    expect(table.columns[0]!.headerText).toBe('V1')
    expect(table.columns.some((c) => /visita/i.test(c.headerText))).toBe(false)
    expect(table.columns.every((c) => c.xCenter > 100)).toBe(true)
  })
})
