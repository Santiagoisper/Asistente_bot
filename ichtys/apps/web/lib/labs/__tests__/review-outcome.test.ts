import { describe, expect, it } from 'vitest'

import type { LabReportRow, LabRowInput } from '../lab-report-content'
import { reviewOutcome } from '../review-outcome'

const read = (line: number, analyte: string, printedValue: string, extra: Partial<LabReportRow> = {}): LabReportRow => ({
  id: `r${line}`,
  analyte,
  printedValue,
  value: Number(printedValue.replace(',', '.')),
  unit: 'mg/dL',
  referenceRange: null,
  sourceLine: line,
  status: 'read',
  isNewField: false,
  reviewReason: null,
  ...extra,
})
const confirmed = (line: number | null, analyte: string, printedValue: string, extra: Partial<LabRowInput> = {}): LabRowInput => ({
  analyte,
  printedValue,
  value: Number(printedValue.replace(',', '.')),
  unit: 'mg/dL',
  referenceRange: null,
  sourceLine: line,
  ...extra,
})

describe('reviewOutcome — cuánto hubo que corregir de lo que leyó la máquina', () => {
  it('todo aceptado tal cual', () => {
    const machine = [read(0, 'Glucosa', '92'), read(1, 'Creatinina', '0,9')]
    expect(reviewOutcome(machine, [confirmed(0, 'Glucosa', '92'), confirmed(1, 'Creatinina', '0,9')])).toEqual({
      machineRows: 2,
      needingDecision: 0,
      unchanged: 2,
      valueCorrected: 0,
      decided: 0,
      labelCorrected: 0,
      removed: 0,
      added: 0,
    })
  })

  it('un valor corregido, un nombre corregido, una fila quitada y una cargada a mano', () => {
    const machine = [read(0, 'Glucosa', '92'), read(1, 'Creatinina', '0,9'), read(2, 'Hemoglobina', '13,5'), read(3, 'Ruido', '7')]
    const after = [
      confirmed(0, 'Glucosa', '95'), // valor distinto
      confirmed(1, 'Creatinina sérica', '0,9'), // mismo valor, otro nombre
      confirmed(2, 'Hemoglobina', '13,5'),
      confirmed(null, 'Urea', '30'), // a mano
    ]
    expect(reviewOutcome(machine, after)).toEqual({
      machineRows: 4,
      needingDecision: 0,
      unchanged: 1,
      valueCorrected: 1,
      decided: 0,
      labelCorrected: 1,
      removed: 1,
      added: 1,
    })
  })

  it('cuenta las filas que la máquina dejó para decidir, aunque se acepten igual', () => {
    const machine = [read(0, 'Glucosa', '92', { status: 'review', reviewReason: 'lecturas distintas', mustDecide: true, alternative: '98' }), read(1, 'Creatinina', '0,9', { status: 'review', reviewReason: 'una sola lectura' })]
    expect(reviewOutcome(machine, [confirmed(0, 'Glucosa', '98'), confirmed(1, 'Creatinina', '0,9')])).toMatchObject({ needingDecision: 2, valueCorrected: 1, unchanged: 1 })
  })

  it('la misma lectura numérica con otra unidad o rango es corrección de etiqueta, no de valor', () => {
    const machine = [read(0, 'Glucosa', '92')]
    expect(reviewOutcome(machine, [confirmed(0, 'Glucosa', '92', { unit: 'mg/dl', referenceRange: '70-110' })])).toMatchObject({ valueCorrected: 0, labelCorrected: 1, unchanged: 0 })
  })

  it('elegir otra lectura numérica del mismo valor impreso es corrección de valor', () => {
    const machine = [read(0, 'Plaquetas', '250.000', { value: 250000 })]
    expect(reviewOutcome(machine, [confirmed(0, 'Plaquetas', '250.000', { value: 250 })])).toMatchObject({ valueCorrected: 1, unchanged: 0 })
  })

  it('si la máquina no había elegido lectura numérica y la persona elige una, es una decisión, no una corrección', () => {
    const machine = [read(0, 'Leucocitos', '7.300', { value: null, status: 'review', reviewReason: 'separador ambiguo' }), read(1, 'Proteínas en orina', 'Negativo', { value: null })]
    const after = [confirmed(0, 'Leucocitos', '7.300', { value: 7300 }), confirmed(1, 'Proteínas en orina', 'Negativo', { value: null })]
    expect(reviewOutcome(machine, after)).toMatchObject({ needingDecision: 1, decided: 1, valueCorrected: 0, unchanged: 1 })
  })

  it('dos filas en la misma línea se emparejan en orden; una fila en una línea que la máquina no leyó cuenta como agregada', () => {
    const machine = [read(4, 'Sodio', '140'), read(4, 'Potasio', '4,1')]
    const after = [confirmed(4, 'Sodio', '140'), confirmed(4, 'Potasio', '4,2'), confirmed(9, 'Cloro', '101')]
    expect(reviewOutcome(machine, after)).toEqual({ machineRows: 2, needingDecision: 0, unchanged: 1, valueCorrected: 1, decided: 0, labelCorrected: 0, removed: 0, added: 1 })
  })
})
