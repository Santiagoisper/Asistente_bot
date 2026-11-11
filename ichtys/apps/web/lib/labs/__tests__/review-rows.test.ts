import { describe, expect, it } from 'vitest'
import type { LabReportRow } from '../lab-report-content'
import { emptyManualRow, readingChoices, rowProblem, toConfirmPayload, toReviewRow, withPrintedValue } from '../review-rows'

const lines = ['[Encabezado omitido: 3 renglones]', 'Hemoglobina ......... 13,5 g/dL (12,0 - 16,0)', 'Leucocitos .......... 7.300 /mm3']
const read: LabReportRow = {
  id: 'r1', analyte: 'Hemoglobina', printedValue: '13,5', value: 13.5, unit: 'g/dL', referenceRange: '12,0 - 16,0',
  sourceLine: 1, status: 'read', isNewField: false, reviewReason: null,
}
const ambiguous: LabReportRow = {
  id: 'r2', analyte: 'Leucocitos', printedValue: '7.300', value: 7300, unit: '/mm3', referenceRange: null,
  sourceLine: 2, status: 'review', isNewField: true, reviewReason: 'Puede ser miles o decimal: confirmá cómo se lee.',
}

describe('filas de la pantalla de revisión', () => {
  it('una fila ambigua llega sin lectura decidida y bloquea la confirmación', () => {
    const row = toReviewRow(ambiguous)
    expect(row.reading).toBe('unset')
    expect(rowProblem(row)).toBe('reading_unset')
    expect(toConfirmPayload([toReviewRow(read), row])).toBeNull()
  })

  it('ofrece las dos lecturas de un valor ambiguo y ninguna si no lo es', () => {
    expect(readingChoices('7.300')).toEqual([7300, 7.3])
    expect(readingChoices('13,5')).toEqual([])
    expect(readingChoices('Negativo')).toEqual([])
  })

  it('elegida la lectura, la fila se confirma con ese número y sigue citando su renglón', () => {
    const payload = toConfirmPayload([toReviewRow(read), { ...toReviewRow(ambiguous), reading: 7.3 }])
    expect(payload).toEqual([
      { analyte: 'Hemoglobina', printedValue: '13,5', value: 13.5, unit: 'g/dL', referenceRange: '12,0 - 16,0', sourceLine: 1 },
      { analyte: 'Leucocitos', printedValue: '7.300', value: 7.3, unit: '/mm3', referenceRange: null, sourceLine: 2 },
    ])
  })

  it('corregir el valor a algo que no está en el renglón lo convierte en carga manual', () => {
    const edited = withPrintedValue(toReviewRow(read), '18,5', lines)
    expect(edited.sourceLine).toBeNull()
    expect(edited.reading).toBe(18.5)
  })

  it('reescribir el mismo valor del renglón conserva la cita', () => {
    const edited = withPrintedValue(toReviewRow(read), '13,5', lines)
    expect(edited.sourceLine).toBe(1)
    expect(edited.reading).toBe(13.5)
  })

  it('corregir a un valor ambiguo vuelve a pedir la lectura', () => {
    const edited = withPrintedValue(toReviewRow(read), '1.350', lines)
    expect(edited.reading).toBe('unset')
    expect(rowProblem(edited)).toBe('reading_unset')
  })

  it('una fila manual vacía no se puede confirmar; completa, sí', () => {
    const blank = emptyManualRow()
    expect(rowProblem(blank)).toBe('missing_analyte')
    expect(rowProblem({ ...blank, analyte: 'RDW-CV' })).toBe('missing_value')
    const filled = withPrintedValue({ ...blank, analyte: ' RDW-CV ' }, ' 13,1 ', lines)
    expect(toConfirmPayload([filled])).toEqual([
      { analyte: 'RDW-CV', printedValue: '13,1', value: 13.1, unit: null, referenceRange: null, sourceLine: null },
    ])
  })

  it('sin filas no hay nada que confirmar', () => {
    expect(toConfirmPayload([])).toBeNull()
  })
})
