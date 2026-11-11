import { describe, expect, it } from 'vitest'
import {
  normalizeAnalyteKey,
  parseLabReportText,
  parsePrintedNumber,
  rowIsGrounded,
} from '../lab-report-parser'

const REPORT = [
  'LABORATORIO CENTRAL S.A.',
  'Paciente: PEREZ, JUAN CARLOS',
  'DNI: 23456789   Edad: 52 años   Sexo: M',
  'Obra social: OSDE 310',
  'PEREZ JUAN CARLOS',
  'Protocolo N° 884512',
  'Fecha de extracción: 05/11/2026',
  'Fecha de nacimiento: 01/02/1974',
  '',
  'HEMOGRAMA COMPLETO',
  'Hematíes ............ 4,62 mill/mm3 (4,20 - 5,40)',
  'Hemoglobina ......... 13,5 g/dL (12,0 - 16,0)',
  'Leucocitos .......... 7.300 /mm3 (4.000 - 10.000)',
  'Plaquetas ........... 248.000 /mm3 (150.000 - 400.000)',
  'Método: impedancia',
  'QUIMICA',
  'Glucosa 92 mg/dl 70 - 110',
  'HEMOGLOBINA GLICOSILADA (HbA1c): 6,8 % VR: 4,0 a 6,0',
  'Creatinina 0.95 mg/dL',
  'Vitamina B12 350 pg/mL 200 - 900',
  '25-OH Vitamina D 30 ng/mL',
  'Troponina T < 0,5 ng/L',
  'Proteínas en orina: Negativo',
  'PEREZ JUAN CARLOS',
  'Paciente: PEREZ, JUAN CARLOS  Página 2',
  'Consultas: laboratorio@example.test',
  'Densidad 1.025',
].join('\n')

describe('parsePrintedNumber — formato argentino', () => {
  it.each([
    ['13,5', 13.5, false],
    ['0.95', 0.95, false],
    ['92', 92, false],
    ['1.234,5', 1234.5, false],
    ['4.620.000', 4620000, false],
    ['248.000', 248000, true],
    ['7.300', 7300, true],
    ['1.025', 1025, true],
    ['1,025', 1.025, true],
  ])('%s → %s (ambiguo: %s)', (printed, value, ambiguous) => {
    expect(parsePrintedNumber(printed)).toEqual({ value, ambiguous })
  })

  it('una desigualdad o un texto no se convierten en número', () => {
    expect(parsePrintedNumber('< 0,5')).toEqual({ value: null, ambiguous: false })
    expect(parsePrintedNumber('>100')).toEqual({ value: null, ambiguous: false })
    expect(parsePrintedNumber('Negativo')).toEqual({ value: null, ambiguous: false })
    expect(parsePrintedNumber('')).toEqual({ value: null, ambiguous: false })
  })
})

describe('normalizeAnalyteKey', () => {
  it('ignora mayúsculas, acentos, signos y espacios de más', () => {
    expect(normalizeAnalyteKey('  Hematíes ')).toBe('hematies')
    expect(normalizeAnalyteKey('HEMATIES')).toBe('hematies')
    expect(normalizeAnalyteKey('Hemoglobina   Glicosilada (HbA1c)')).toBe('hemoglobina glicosilada hba1c')
    expect(normalizeAnalyteKey('RDW-CV')).toBe('rdw cv')
  })
})

describe('parseLabReportText', () => {
  const parsed = parseLabReportText(REPORT)
  const row = (analyte: string) => parsed.rows.find((entry) => entry.analyte === analyte)

  it('lee cada analito con su valor impreso tal cual, unidad y rango', () => {
    expect(row('Hematíes')).toMatchObject({ printedValue: '4,62', value: 4.62, unit: 'mill/mm3', referenceRange: '4,20 - 5,40', needsReview: false })
    expect(row('Hemoglobina')).toMatchObject({ printedValue: '13,5', value: 13.5, unit: 'g/dL', referenceRange: '12,0 - 16,0' })
    expect(row('Glucosa')).toMatchObject({ printedValue: '92', value: 92, unit: 'mg/dl', referenceRange: '70 - 110' })
    expect(row('HEMOGLOBINA GLICOSILADA (HbA1c)')).toMatchObject({ printedValue: '6,8', value: 6.8, unit: '%', referenceRange: '4,0 a 6,0' })
    expect(row('Creatinina')).toMatchObject({ printedValue: '0.95', value: 0.95, unit: 'mg/dL', referenceRange: null })
  })

  it('no confunde los dígitos del nombre con el valor', () => {
    expect(row('Vitamina B12')).toMatchObject({ printedValue: '350', value: 350, unit: 'pg/mL', referenceRange: '200 - 900' })
    expect(row('25-OH Vitamina D')).toMatchObject({ printedValue: '30', value: 30, unit: 'ng/mL' })
  })

  it('miles o decimal: propone miles y obliga a revisar, con el motivo escrito', () => {
    for (const analyte of ['Leucocitos', 'Plaquetas', 'Densidad']) {
      const entry = row(analyte)
      expect(entry?.needsReview).toBe(true)
      expect(entry?.reviewReason).toMatch(/miles o decimal/)
    }
    expect(row('Leucocitos')).toMatchObject({ printedValue: '7.300', value: 7300 })
  })

  it('desigualdades y resultados cualitativos se conservan impresos, sin número', () => {
    expect(row('Troponina T')).toMatchObject({ printedValue: '< 0,5', value: null, unit: 'ng/L' })
    expect(row('Proteínas en orina')).toMatchObject({ printedValue: 'Negativo', value: null, unit: null })
  })

  it('no toma como resultado un renglón de método, edad, protocolo o fecha', () => {
    const names = parsed.rows.map((entry) => entry.analyte.toLowerCase())
    for (const banned of ['método', 'edad', 'protocolo n°', 'fecha de extracción', 'dni']) {
      expect(names).not.toContain(banned)
    }
    expect(parsed.rows).toHaveLength(12)
  })

  it('la transcripción no conserva nombre, documento, obra social, nacimiento ni correo', () => {
    for (const leaked of ['PEREZ', 'JUAN', '23456789', 'OSDE', '1974', '884512', 'laboratorio@example.test']) {
      expect(parsed.transcription).not.toContain(leaked)
    }
    expect(parsed.piiRedactedCount).toBeGreaterThanOrEqual(8)
  })

  it('conserva la fecha de extracción y los renglones de resultado sin tocar', () => {
    expect(parsed.transcription).toContain('Fecha de extracción: 05/11/2026')
    expect(parsed.transcription).toContain('Hemoglobina ......... 13,5 g/dL (12,0 - 16,0)')
    expect(parsed.transcription).toContain('Plaquetas ........... 248.000 /mm3 (150.000 - 400.000)')
  })

  it('sin inventar: cada fila cita un renglón que contiene su valor impreso', () => {
    for (const entry of parsed.rows) {
      expect(rowIsGrounded(entry, parsed.lines)).toBe(true)
      expect(parsed.lines[entry.sourceLine]).toContain(entry.printedValue)
    }
  })

  it('una fila con un valor que no está en su renglón no pasa la verificación', () => {
    const first = parsed.rows[0]!
    expect(rowIsGrounded({ ...first, printedValue: '99,9' }, parsed.lines)).toBe(false)
    expect(rowIsGrounded({ ...first, sourceLine: 9_999 }, parsed.lines)).toBe(false)
  })

  it('texto sin resultados: ninguna fila y nada del encabezado en la transcripción', () => {
    const empty = parseLabReportText('Paciente: GOMEZ ANA\nDNI 30111222\nSin resultados cargados')
    expect(empty.rows).toEqual([])
    expect(empty.transcription).not.toContain('GOMEZ')
    expect(empty.transcription).not.toContain('30111222')
  })

  it('un texto enorme no cuelga el intérprete y respeta el tope de filas', () => {
    const big = Array.from({ length: 5_000 }, (_, index) => `Analito ${String.fromCharCode(65 + (index % 26))}${index} 1,${index % 10} mg/dL`).join('\n')
    const result = parseLabReportText(big)
    expect(result.rows.length).toBeLessThanOrEqual(500)
  })
})
