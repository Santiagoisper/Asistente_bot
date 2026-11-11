import { describe, expect, it } from 'vitest'
import { normalizePageLines } from '../parser'

const item = (str: string, x: number, y: number, width = str.length * 5) => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10 })

describe('normalizePageLines — texto de una página conservando renglones', () => {
  it('agrupa por altura y ordena de izquierda a derecha, aunque los ítems lleguen desordenados', () => {
    const text = normalizePageLines([
      item('12,0 - 16,0', 300, 700),
      item('Glucosa', 50, 686),
      item('Hemoglobina', 50, 700),
      item('92', 200, 686),
      item('13,5', 200, 700),
      item('g/dL', 240, 700),
      item('HEMOGRAMA', 50, 720),
    ])
    expect(text.split('\n')).toEqual(['HEMOGRAMA', 'Hemoglobina 13,5 g/dL 12,0 - 16,0', 'Glucosa 92'])
  })

  it('tolera un desnivel chico dentro del mismo renglón (subíndices, fuentes mezcladas)', () => {
    expect(normalizePageLines([item('Creatinina', 50, 500), item('0.95', 200, 501.5), item('mg/dL', 240, 499)])).toBe('Creatinina 0.95 mg/dL')
  })

  it('pega los fragmentos de una misma palabra y separa las columnas', () => {
    expect(normalizePageLines([item('Hemo', 50, 400, 20), item('globina', 70, 400, 35), item('13,5', 200, 400)])).toBe('Hemoglobina 13,5')
  })

  it('ignora ítems sin posición o vacíos y no falla con una página vacía', () => {
    expect(normalizePageLines([{ str: 'sin posición' }, item('', 10, 10), null, 42])).toBe('')
    expect(normalizePageLines([])).toBe('')
  })
})
