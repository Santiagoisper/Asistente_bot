import { describe, expect, it } from 'vitest'
import { containsPrintedValue, groundReaderRows, mergeImageReadings, mergeTextReadings, type ReaderRow } from '../lab-readings'
import { parseLabReportText } from '../lab-report-parser'

const T = '\t'
const reader = (analyte: string, printedValue: string, line: number, unit: string | null = null): ReaderRow => ({ analyte, printedValue, unit, referenceRange: null, line })

describe('containsPrintedValue — el valor figura entero, no como parte de otro número', () => {
  it('acepta el valor tal cual, pegado a su unidad o a dos puntos', () => {
    expect(containsPrintedValue('Hemoglobina\t13,5\tg/dL', '13,5')).toBe(true)
    expect(containsPrintedValue('Neutrófilos\t61,3%\t4810/mm3', '61,3')).toBe(true)
    expect(containsPrintedValue('Resultado:5.1 %Hbglic', '5.1')).toBe(true)
    expect(containsPrintedValue('TSH < 0,5 ng/L', '< 0,5')).toBe(true)
    expect(containsPrintedValue('VDRL: No Reactivo', 'No Reactivo')).toBe(true)
  })

  it('rechaza un valor que es un pedazo de otro número', () => {
    expect(containsPrintedValue('Hemoglobina 13,5 g/dL', '3,5')).toBe(false)
    expect(containsPrintedValue('Hemoglobina 13,5 g/dL', '13')).toBe(false)
    expect(containsPrintedValue('Plaquetas 248.000 /mm3', '248')).toBe(false)
    expect(containsPrintedValue('Plaquetas 248.000 /mm3', '8.000')).toBe(false)
    expect(containsPrintedValue('Glucosa 92.5', '92')).toBe(false)
  })

  it('un valor vacío nunca figura', () => {
    expect(containsPrintedValue('Glucosa 92', '')).toBe(false)
    expect(containsPrintedValue('Glucosa 92', '   ')).toBe(false)
  })
})

describe('groundReaderRows — lo que propone el modelo se comprueba contra el texto', () => {
  const lines = ['Hemograma', 'Hemoglobina\t13,5\tg/dL\t12,0-16,0', 'Glucosa\t92\tmg/dL', 'Urea\t30\tmg/dL']

  it('conserva las filas cuyo valor figura en el renglón citado', () => {
    const { rows, dropped } = groundReaderRows([reader('Hemoglobina', '13,5', 1, 'g/dL'), reader('Glucosa', '92', 2)], lines)
    expect(rows.map((row) => [row.analyte, row.printedValue, row.line])).toEqual([['Hemoglobina', '13,5', 1], ['Glucosa', '92', 2]])
    expect(dropped).toBe(0)
  })

  it('descarta un valor inventado o mal copiado', () => {
    const { rows, dropped } = groundReaderRows([reader('Hemoglobina', '18,5', 1), reader('Hemoglobina', '3,5', 1), reader('Glucosa', '92', 2)], lines)
    expect(rows.map((row) => row.analyte)).toEqual(['Glucosa'])
    expect(dropped).toBe(2)
  })

  it('si el modelo erró el renglón por uno y el valor está al lado, lo reubica', () => {
    const { rows } = groundReaderRows([reader('Urea', '30', 2)], lines)
    expect(rows[0]?.line).toBe(3)
  })

  it('descarta un renglón que no existe, un nombre vacío y un valor que es un rango', () => {
    const { rows, dropped } = groundReaderRows([reader('Glucosa', '92', 99), reader('  ', '92', 2), reader('Hemoglobina', '12,0-16,0', 1)], lines)
    expect(rows).toEqual([])
    expect(dropped).toBe(3)
  })

  it('acepta un comparador y separa la unidad que el modelo pegó al valor', () => {
    const local = ['Lipoproteína A\t< 20\tnmol/L', 'Hemoglobina\t13,5 g/dL']
    const { rows } = groundReaderRows([reader('Lipoproteína A', '< 20', 0), reader('Hemoglobina', '13,5 g/dL', 1)], local)
    expect(rows.map((row) => [row.analyte, row.printedValue, row.unit])).toEqual([['Lipoproteína A', '< 20', null], ['Hemoglobina', '13,5', 'g/dL']])
  })

  it('no admite dos filas iguales para el mismo valor del mismo renglón', () => {
    const { rows } = groundReaderRows([reader('Glucosa', '92', 2), reader('Glucemia', '92', 2)], lines)
    expect(rows).toHaveLength(1)
  })
})

describe('mergeTextReadings — reglas + modelo sobre un PDF con texto', () => {
  const text = ['Paciente: GOMEZ ANA', ['Hemoglobina', '13,5', 'g/dL', '12,0-16,0'].join(T), ['Glucosa', '92', 'mg/dL'].join(T), ['Relación A/G', 'aprox. 1,4'].join(T)].join('\n')
  const parsed = parseLabReportText(text)
  const lineOf = (needle: string) => parsed.lines.findIndex((line) => line.includes(needle))

  it('sin segunda lectura, quedan las filas de las reglas sin cambios', () => {
    const merged = mergeTextReadings(parsed.rows, null, parsed.lines)
    expect(merged.rows.map((row) => [row.analyte, row.printedValue, row.needsReview])).toEqual([['Hemoglobina', '13,5', false], ['Glucosa', '92', false]])
    expect(merged.agreed).toBe(0)
  })

  it('cuando las dos coinciden, la fila queda leída', () => {
    const merged = mergeTextReadings(parsed.rows, [reader('Hemoglobina', '13,5', lineOf('Hemoglobina')), reader('Glucosa', '92', lineOf('Glucosa'))], parsed.lines)
    expect(merged.rows.every((row) => !row.needsReview)).toBe(true)
    expect(merged.agreed).toBe(2)
  })

  it('lo que solo encontró el modelo entra para revisar, siempre que figure en el texto', () => {
    const merged = mergeTextReadings(
      parsed.rows,
      [reader('Hemoglobina', '13,5', lineOf('Hemoglobina')), reader('Glucosa', '92', lineOf('Glucosa')), reader('Relación A/G', '1,4', lineOf('Relación')), reader('Calcio', '9,9', lineOf('Glucosa'))],
      parsed.lines,
    )
    expect(merged.rows.map((row) => [row.analyte, row.printedValue, row.needsReview])).toEqual([
      ['Hemoglobina', '13,5', false],
      ['Glucosa', '92', false],
      ['Relación A/G', '1,4', true],
    ])
    expect(merged.rows[2]?.reviewReason).toMatch(/segunda lectura/)
    expect(merged.dropped).toBe(1)
  })

  it('lo que el modelo no encontró queda para revisar', () => {
    const merged = mergeTextReadings(parsed.rows, [reader('Hemoglobina', '13,5', lineOf('Hemoglobina'))], parsed.lines)
    expect(merged.rows.map((row) => [row.analyte, row.needsReview])).toEqual([['Hemoglobina', false], ['Glucosa', true]])
  })

  it('si el modelo le pone otro nombre al mismo valor, queda para revisar con el nombre propuesto', () => {
    const merged = mergeTextReadings(parsed.rows, [reader('Hb', '13,5', lineOf('Hemoglobina')), reader('Glucosa en sangre', '92', lineOf('Glucosa'))], parsed.lines)
    expect(merged.rows[0]).toMatchObject({ analyte: 'Hemoglobina', needsReview: true })
    expect(merged.rows[0]?.reviewReason).toContain('«Hb»')
    // Un nombre que contiene al otro es el mismo analito.
    expect(merged.rows[1]).toMatchObject({ analyte: 'Glucosa', needsReview: false })
  })

  it('no pisa el motivo de revisión que ya traía la fila', () => {
    const ambiguous = parseLabReportText(['Paciente: X', ['Leucocitos', '7.200', '/mm3'].join(T)].join('\n'))
    const merged = mergeTextReadings(ambiguous.rows, [], ambiguous.lines)
    expect(merged.rows[0]?.reviewReason).toMatch(/miles o decimal/)
  })
})

describe('mergeImageReadings — dos lecturas de una foto o un escaneo', () => {
  const a = { lines: ['Hemoglobina 13,5 g/dL', 'Glucosa 92 mg/dL', 'Urea 30 mg/dL', 'Creatinina 0,9 mg/dL'], rows: [reader('Hemoglobina', '13,5', 0, 'g/dL'), reader('Glucosa', '92', 1), reader('Urea', '30', 2), reader('Creatinina', '0,9', 3)] }

  it('coinciden: filas leídas, sin nada que decidir', () => {
    const merged = mergeImageReadings(a, { lines: a.lines, rows: [...a.rows] })
    expect(merged.rows.map((row) => [row.analyte, row.printedValue, row.mustDecide])).toEqual([['Hemoglobina', '13,5', false], ['Glucosa', '92', false], ['Urea', '30', false], ['Creatinina', '0,9', false]])
    expect(merged.disagreements).toBe(0)
    expect(merged.lines).toEqual(a.lines)
  })

  it('un dígito distinto obliga a decidir y muestra las dos lecturas', () => {
    const merged = mergeImageReadings(a, { lines: [], rows: [reader('Hemoglobina', '18,5', 0), reader('Glucosa', '92', 1), reader('Urea', '30', 2), reader('Creatinina', '0,9', 3)] })
    expect(merged.rows[0]).toMatchObject({ printedValue: '13,5', alternative: '18,5', mustDecide: true, needsReview: true })
    expect(merged.rows[0]?.reviewReason).toContain('«13,5»')
    expect(merged.rows[0]?.reviewReason).toContain('«18,5»')
    expect(merged.disagreements).toBe(1)
  })

  it('coma y punto no son lo mismo: 0,9 contra 0.9 se decide', () => {
    const merged = mergeImageReadings(a, { lines: [], rows: [reader('Hemoglobina', '13,5', 0), reader('Glucosa', '92', 1), reader('Urea', '30', 2), reader('Creatinina', '0.9', 3)] })
    expect(merged.rows[3]).toMatchObject({ mustDecide: true, alternative: '0.9' })
  })

  it('empareja por nombre aunque el orden o la escritura cambien', () => {
    const merged = mergeImageReadings(a, { lines: [], rows: [reader('UREA', '30', 0), reader('Creatinina sérica', '0,9', 1), reader('Hemoglobina', '13,5', 2), reader('Glucosa', '92', 3)] })
    expect(merged.disagreements).toBe(0)
  })

  it('lo que vio una sola lectura obliga a decidir', () => {
    const merged = mergeImageReadings(a, { lines: [], rows: [reader('Hemoglobina', '13,5', 0), reader('Glucosa', '92', 1), reader('Urea', '30', 2), reader('Sodio', '140', 5)] })
    const creatinina = merged.rows.find((row) => row.analyte === 'Creatinina')
    const sodio = merged.rows.find((row) => row.analyte === 'Sodio')
    expect(creatinina).toMatchObject({ mustDecide: true, alternative: null })
    expect(sodio).toMatchObject({ printedValue: '140', mustDecide: true, sourceLine: null })
    expect(merged.disagreements).toBe(2)
  })

  it('sin segunda lectura nada queda como leído: todo para revisar', () => {
    const merged = mergeImageReadings(a, null)
    expect(merged.rows.every((row) => row.needsReview && !row.mustDecide)).toBe(true)
    expect(merged.singleReading).toBe(true)
  })

  it('una fila cuyo valor no está en la transcripción de la propia lectura se descarta', () => {
    const merged = mergeImageReadings({ lines: ['Glucosa 92 mg/dL'], rows: [reader('Glucosa', '92', 0), reader('Urea', '30', 0)] }, null)
    expect(merged.rows.map((row) => row.analyte)).toEqual(['Glucosa'])
    expect(merged.dropped).toBe(1)
  })

  it('el valor ambiguo de miles conserva su motivo además de la comparación', () => {
    const merged = mergeImageReadings({ lines: ['Leucocitos 7.200'], rows: [reader('Leucocitos', '7.200', 0)] }, { lines: [], rows: [reader('Leucocitos', '7.200', 0)] })
    expect(merged.rows[0]).toMatchObject({ needsReview: true, mustDecide: false })
    expect(merged.rows[0]?.reviewReason).toMatch(/miles o decimal/)
  })
})
