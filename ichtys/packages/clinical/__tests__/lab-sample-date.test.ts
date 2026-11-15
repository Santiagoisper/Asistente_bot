import { describe, expect, it } from 'vitest'
import { acceptableSampleDate, latestSampleDate, proposeSampleDate } from '../lab-sample-date'
import { parseLabReportText } from '../lab-report-parser'
import { parsePatientProfile } from '../profile-schema'
import { assessScreening } from '../screening-engine'

/**
 * La fecha de la muestra de un informe (C4, decisiones D2 y D3 de
 * docs/decisions/huella-y-procedencia-de-archivos.md). El lector la propone solo desde un
 * renglón de extracción, toma o muestra; nunca desde emisión, recepción ni validación, y nunca
 * la inventa. La confirma una persona.
 */
describe('proposeSampleDate', () => {
  it.each([
    ['Fecha de extracción: 24/09/2026', '2026-09-24'],
    ['Fecha de extraccion 24/09/2026', '2026-09-24'],
    ['Fecha de toma: 5/9/2026', '2026-09-05'],
    ['Fecha de toma de muestra: 05-09-2026', '2026-09-05'],
    ['Fecha de la muestra: 05.09.26', '2026-09-05'],
    ['FECHA MUESTRA: 24/09/2026', '2026-09-24'],
    ['Fecha de extracción: 24/09/2026 08:02', '2026-09-24'],
    ['Fecha y hora de extracción: 24/09/2026 08:02 hs', '2026-09-24'],
  ])('%s → %s', (line, expected) => {
    expect(proposeSampleDate(['Hemograma', line, 'Hemoglobina 13,5 g/dL'])).toBe(expected)
  })

  it.each([
    ['Fecha de emisión: 25/09/2026'],
    ['Fecha de informe: 25/09/2026'],
    ['Fecha de recepción: 24/09/2026'],
    ['Fecha de ingreso: 24/09/2026'],
    ['Fecha de validación: 25/09/2026'],
    ['Fecha: 24/09/2026'],
    ['Fecha de nacimiento: 01/02/1970'],
    ['Impreso el 25/09/2026'],
    ['Muestra: sangre entera'],
    ['La fecha de extracción fue informada por el paciente: 24/09/2026 según refiere'],
  ])('no propone desde: %s', (line) => {
    expect(proposeSampleDate([line])).toBeNull()
  })

  it('un informe cuyo único renglón de fecha es el de emisión no propone fecha de muestra (prueba 7)', () => {
    expect(proposeSampleDate(['Laboratorio de ensayo', 'Fecha de emisión: 25/09/2026', 'Glucemia 98 mg/dL'])).toBeNull()
  })

  it('con extracción y emisión, propone la de extracción', () => {
    expect(proposeSampleDate(['Fecha de emisión: 25/09/2026', 'Fecha de extracción: 24/09/2026'])).toBe('2026-09-24')
  })

  it('la misma fecha dos veces es una sola', () => {
    expect(proposeSampleDate(['Fecha de extracción: 24/09/2026', 'Fecha de toma: 24/9/26'])).toBe('2026-09-24')
  })

  it('dos fechas de muestra distintas: no elige, no propone ninguna', () => {
    expect(proposeSampleDate(['Fecha de extracción: 24/09/2026', 'Fecha de toma: 23/09/2026'])).toBeNull()
  })

  it.each([['Fecha de extracción: 31/02/2026'], ['Fecha de extracción: 24/13/2026'], ['Fecha de extracción: 00/09/2026']])('una fecha que no existe no se propone: %s', (line) => {
    expect(proposeSampleDate([line])).toBeNull()
  })

  it('sin renglones, nada', () => {
    expect(proposeSampleDate([])).toBeNull()
  })

  it('el lector de informes conserva el renglón de extracción también cuando trae hora, y de ahí sale la propuesta', () => {
    const parsed = parseLabReportText(['Laboratorio de ensayo', 'Paciente: inventado', 'Fecha de extracción: 24/09/2026 08:02', 'Hemoglobina 13,5 g/dL 12,0 - 16,0'].join('\n'))
    expect(parsed.transcription).toContain('Fecha de extracción: 24/09/2026 08:02')
    expect(parsed.transcription).not.toContain('inventado')
    expect(proposeSampleDate(parsed.transcription.split('\n'))).toBe('2026-09-24')
  })
})

describe('acceptableSampleDate — lo que una persona puede confirmar', () => {
  const today = '2026-11-14'

  it('una fecha real, de hoy o anterior', () => {
    expect(acceptableSampleDate('2026-09-24', today)).toBe(true)
    expect(acceptableSampleDate('2026-11-14', today)).toBe(true)
  })

  it('el día siguiente vale: en otra zona horaria ya es mañana', () => {
    expect(acceptableSampleDate('2026-11-15', today)).toBe(true)
  })

  it('una fecha futura no', () => {
    expect(acceptableSampleDate('2026-11-16', today)).toBe(false)
    expect(acceptableSampleDate('2027-01-01', today)).toBe(false)
  })

  it.each([['2026-02-31'], ['24/09/2026'], [''], ['2026-9-24'], ['1899-12-31']])('lo que no es una fecha razonable no: %s', (value) => {
    expect(acceptableSampleDate(value, today)).toBe(false)
  })
})

/**
 * Guarda de alcance (prueba 11 de la nota, decisión D6): la fecha de la muestra se guarda, y
 * ninguna regla de elegibilidad la lee. Si alguien la conecta a una regla sin la decisión de
 * Santiago sobre la ventana de vigencia, esta prueba se pone en rojo.
 */
describe('la elegibilidad no lee la fecha de la muestra', () => {
  const PROTOCOL = {
    inclusionCriteria: [
      { number: '2.1', text: 'Adultos de 18 a 75 anos de edad.' },
      { number: '2.2', text: 'HbA1c entre 7,0 % y 10,5 % en la visita de seleccion.' },
      { number: '2.3', text: 'Indice de masa corporal entre 23 y 40 kg/m2.' },
    ],
    exclusionCriteria: [
      { number: '3.1', text: 'Tasa de filtrado glomerular estimada menor de 45 mL/min/1,73 m2.' },
      { number: '3.2', text: 'ALT o AST mayor a 3 veces el limite superior normal.' },
    ],
  }
  const REPORT = '11111111-1111-4111-8111-111111111111'
  const withDate = (sampleDate: string | null | undefined) =>
    parsePatientProfile({
      version: 1,
      demographics: { ageYears: 58 },
      labs: [
        { name: 'HbA1c', value: 7.9, unit: '%' },
        { name: 'Filtrado glomerular estimado', value: 72, unit: 'mL/min' },
        { name: 'ALT', value: 31, unit: 'U/L', referenceRange: 'hasta 40' },
        { name: 'AST', value: 24, unit: 'U/L', referenceRange: 'hasta 40' },
        { name: 'Peso', value: 78, unit: 'kg' },
        { name: 'Talla', value: 163, unit: 'cm' },
      ].map((lab) => ({ ...lab, source: { kind: 'lab_report', reportId: REPORT }, ...(sampleDate === undefined ? {} : { sampleDate }) })),
      medications: [],
      conditions: [],
    })
  const verdicts = (sampleDate: string | null | undefined) => assessScreening(withDate(sampleDate), PROTOCOL).map((item) => [item.criterionNumber, item.status, item.reason])

  it('la misma ficha con muestra de hace 2 días, de hace 2 años, desconocida o sin el dato da el mismo estado y el mismo motivo en todas las reglas', () => {
    const recent = verdicts('2026-11-12')
    expect(recent.length).toBe(5)
    expect(recent.some(([, status]) => status === 'pass' || status === 'fail')).toBe(true)
    expect(verdicts('2024-11-12')).toEqual(recent)
    expect(verdicts(null)).toEqual(recent)
    expect(verdicts(undefined)).toEqual(recent)
  })
})

describe('latestSampleDate — el límite del calendario es el del validador', () => {
  it('es el día siguiente al de hoy (UTC), también al cambiar de mes y de año', () => {
    expect(latestSampleDate('2026-11-14')).toBe('2026-11-15')
    expect(latestSampleDate('2026-11-30')).toBe('2026-12-01')
    expect(latestSampleDate('2026-12-31')).toBe('2027-01-01')
  })

  it('lo último que ofrece el calendario se acepta, y un día más no', () => {
    expect(acceptableSampleDate('2026-11-15', '2026-11-14')).toBe(true)
    expect(acceptableSampleDate('2026-11-16', '2026-11-14')).toBe(false)
  })

  it('con un «hoy» que no es fecha, no hay límite que ofrecer', () => {
    expect(latestSampleDate('ayer')).toBeNull()
  })
})

describe('proposeSampleDate — rótulos sin la palabra «fecha» (informes del país)', () => {
  it.each([
    ['Toma de muestra: 24/09/2026'],
    ['Extracción: 24/09/2026'],
    ['Extraccion 24/09/2026 08:15'],
    ['F. extracción: 24/09/2026'],
    ['F. de extracción: 24/09/2026'],
    ['Muestra: 24-09-2026'],
  ])('%s → la propone', (line) => {
    expect(proposeSampleDate([line])).toBe('2026-09-24')
  })

  it.each([
    ['24/09/2026'],
    ['F. nacimiento: 24/09/1960'],
    ['F. emisión: 26/09/2026'],
    ['F. 24/09/2026'],
    ['Muestra: suero'],
    ['Muestra recibida 25/09/2026'],
    ['Recepción de muestra: 25/09/2026'],
  ])('%s → no propone nada', (line) => {
    expect(proposeSampleDate([line])).toBeNull()
  })

  it('el lector de informes conserva esos renglones y sigue tapando una fecha suelta o de nacimiento', () => {
    const kept = (line: string) => parseLabReportText(['LABORATORIO X', 'Paciente: ENSAYO, INVENTADO', line, 'HEMOGRAMA', 'Glucosa 92 mg/dl 70 - 110'].join('\n')).transcription
    expect(kept('Toma de muestra: 24/09/2026')).toContain('Toma de muestra: 24/09/2026')
    expect(kept('F. extracción: 24/09/2026 08:15')).toContain('F. extracción: 24/09/2026 08:15')
    expect(kept('F. nacimiento: 24/09/1960')).not.toContain('1960')
    expect(kept('24/09/1960')).not.toContain('1960')
  })
})

describe('proposeSampleDate — con la fecha de hoy no propone lo que no se podría confirmar', () => {
  it('un año de dos cifras que da una fecha futura no se propone', () => {
    expect(proposeSampleDate(['Fecha de extracción: 24/09/98'])).toBe('2098-09-24')
    expect(proposeSampleDate(['Fecha de extracción: 24/09/98'], '2026-11-14')).toBeNull()
  })

  it('un año de dos cifras que da una fecha pasada sí', () => {
    expect(proposeSampleDate(['Fecha de extracción: 24/09/26'], '2026-11-14')).toBe('2026-09-24')
  })
})
