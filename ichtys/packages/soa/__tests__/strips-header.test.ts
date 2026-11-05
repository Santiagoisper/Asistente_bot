/**
 * P2c C1a — detección de TODAS las tiras de encabezado de una página, con la
 * ficha PARTIDA en dos filas (estructura verificada del protocolo real de 46
 * columnas): tiras apiladas por página, letras (prefijo de la ficha) arriba y
 * números unos puntos más abajo alineados en x, cada tira con su etiqueta de
 * fila y sus filas de datos colgando debajo; las tiras se repiten en cada
 * página.
 *
 * ROJO esperado contra P2b: el detector devuelve UNA fila de encabezado por
 * página (la mejor), así que la segunda tira no existe para el lector y sus
 * fichas nunca se registran: la mitad de la tabla desaparece de la lectura.
 */
import { describe, expect, it } from 'vitest'
import { findNumericHeaders } from '../header'
import { locateSchedule } from '../index'
import { buildStrips, SPLIT_CHIP_GAP } from './synthetic-pages'

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

describe('P2c C1a — findNumericHeaders: todas las tiras de la página, ficha partida', () => {
  const { pages } = buildStrips(DOC)

  it('devuelve las DOS tiras de la página, de arriba a abajo', () => {
    const strips = findNumericHeaders(pages[0]!.items)
    expect(strips).toHaveLength(2)
  })

  it('cada tira compone la ficha partida: prefijo (letras) + número alineados en x', () => {
    const strips = findNumericHeaders(pages[0]!.items)
    expect(strips.map((s) => s.chips)).toEqual([CHIPS_A, CHIPS_B])
    // La letra vive SPLIT_CHIP_GAP pt sobre el número de SU ficha.
    for (const strip of strips) {
      expect(strip.letters.length).toBeGreaterThan(0)
      for (const letter of strip.letters) {
        const below = strip.tokens.find(
          (t) => t.bbox[0] < letter.bbox[2] && t.bbox[2] > letter.bbox[0],
        )
        expect(below, `letra «${letter.str}» sin número alineado`).toBeDefined()
        expect(letter.bbox[3] - below!.bbox[3]).toBeGreaterThanOrEqual(SPLIT_CHIP_GAP - 2)
      }
    }
  })

  it('una ficha sin prefijo (número solo) también es columna de su tira', () => {
    const { pages: p2 } = buildStrips({
      strips: [
        { label: 'Número de visita', chips: ['1', '2', '3', '4'] },
        { label: 'Número de visita', chips: ['V5', 'V6', 'V7', 'V8'] },
      ],
      rowsPerPage: [2, 2],
    })
    const strips = findNumericHeaders(p2[0]!.items)
    expect(strips.map((s) => s.chips)).toEqual([['1', '2', '3', '4'], ['V5', 'V6', 'V7', 'V8']])
    expect(strips[0]!.letters).toHaveLength(0) // la primera tira no tiene letras
    expect(strips[0]!.letters.length + strips[1]!.letters.length).toBe(4)
  })

  it('una banda «Día» bajo el encabezado de visitas NO es otra tira: es estructura', () => {
    const { pages } = buildStrips({
      strips: [{ label: 'Número de visita', chips: CHIPS_A }],
      rowsPerPage: [3, 3],
      timeRow: { label: 'Día', values: [1, 8, 15, 22, 29, 36, 43, 50] },
    })
    const strips = findNumericHeaders(pages[0]!.items)
    expect(strips).toHaveLength(1)
    expect(strips[0]!.chips).toEqual(CHIPS_A)
  })

  it('el localizador ve las fichas de las DOS tiras en la firma de la tabla', () => {
    const location = locateSchedule(pages)
    expect(location.tables).toHaveLength(1)
    expect(location.tables[0]!.headerSignature).toEqual(expect.arrayContaining(ALL_CHIPS))
    expect(location.tables[0]!.headerKind).toBe('numeric_visit')
  })

  it('el detector es determinista: misma entrada, misma salida', () => {
    expect(findNumericHeaders(pages[1]!.items)).toEqual(findNumericHeaders(pages[1]!.items))
  })
})
