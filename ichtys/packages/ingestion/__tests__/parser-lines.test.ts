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
    expect(text.split('\n')).toEqual(['HEMOGRAMA', 'Hemoglobina\t13,5\tg/dL\t12,0 - 16,0', 'Glucosa\t92'])
  })

  it('tolera un desnivel chico dentro del mismo renglón (subíndices, fuentes mezcladas)', () => {
    expect(normalizePageLines([item('Creatinina', 50, 500), item('0.95', 200, 501.5), item('mg/dL', 240, 499)])).toBe('Creatinina\t0.95\tmg/dL')
  })

  it('pega los fragmentos de una misma palabra y separa las columnas', () => {
    expect(normalizePageLines([item('Hemo', 50, 400, 20), item('globina', 70, 400, 35), item('13,5', 200, 400)])).toBe('Hemoglobina\t13,5')
  })

  it('ignora ítems sin posición o vacíos y no falla con una página vacía', () => {
    expect(normalizePageLines([{ str: 'sin posición' }, item('', 10, 10), null, 42])).toBe('')
    expect(normalizePageLines([])).toBe('')
  })

  it('separa con tabulación solo los huecos de columna: las palabras de una misma celda quedan con espacio', () => {
    const text = normalizePageLines([item('Colesterol', 50, 300, 50), item('Total', 103, 300, 25), item('176', 250, 300, 15), item('mg/dL', 268, 300, 25)])
    expect(text).toBe('Colesterol Total\t176 mg/dL')
  })

  it('marca con tabulación inicial el renglón que empieza en la mitad derecha de la hoja', () => {
    const text = normalizePageLines(
      [item('Glucosa', 50, 300, 35), item('92', 250, 300, 10), item('Normal: 70 a 99', 390, 300, 75), item('Diabetes: mayor a 126', 390, 288, 100)],
      { pageWidth: 595 },
    )
    expect(text.split('\n')).toEqual(['Glucosa\t92\tNormal: 70 a 99', '\tDiabetes: mayor a 126'])
  })

  it('sin ancho de página lo estima con los márgenes del texto', () => {
    const text = normalizePageLines([item('Glucosa', 40, 300, 35), item('Normal: 70 a 99', 390, 300, 160), item('hasta 110', 390, 288, 45)])
    expect(text.split('\n')[1]).toBe('\thasta 110')
  })

  it('un ítem sin ancho declarado no se pega al siguiente', () => {
    const noWidth = { str: 'Urea', transform: [10, 0, 0, 10, 50, 300], height: 10 }
    expect(normalizePageLines([noWidth, item('30', 250, 300)])).toBe('Urea\t30')
  })
})
