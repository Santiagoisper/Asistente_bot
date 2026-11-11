import { describe, expect, it } from 'vitest'

// El servicio importa el cliente de base y el lector de PDF; estas pruebas son de las funciones puras.
import { vi } from 'vitest'
vi.mock('@ichtys/db', () => ({ db: {}, and: vi.fn(), eq: vi.fn(), inArray: vi.fn(), labAnalytes: {}, labReports: {} }))
vi.mock('@ichtys/ingestion/parser', () => ({ parsePdf: vi.fn(), PdfParseError: class extends Error {} }))
vi.mock('../../subjects/patient-profile-service', () => ({ loadPatientProfile: vi.fn(), persistPatientProfile: vi.fn() }))

import { allowedReadings, finalizeRows, LabReportError } from '../lab-report-service'
import { labConfirmSchema, labRowInputSchema } from '../lab-report-content'

const lines = ['[Encabezado omitido: 3 renglones]', 'Hemoglobina ......... 13,5 g/dL (12,0 - 16,0)', 'Leucocitos .......... 7.300 /mm3']
const base = { analyte: 'Hemoglobina', printedValue: '13,5', value: 13.5, unit: 'g/dL', referenceRange: '12,0 - 16,0', sourceLine: 1 }

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    if (err instanceof LabReportError) return err.code
    throw err
  }
  return 'ok'
}

describe('lecturas posibles de un valor impreso', () => {
  it('un valor sin ambigüedad admite su número o dejarlo sin número', () => {
    expect(allowedReadings('13,5')).toEqual([13.5, null])
  })
  it('un valor ambiguo admite las dos lecturas', () => {
    expect(allowedReadings('7.300')).toEqual([7300, 7.3, null])
    expect(allowedReadings('1,025')).toEqual([1.025, 1025, null])
  })
  it('un texto o una desigualdad no admiten número', () => {
    expect(allowedReadings('Negativo')).toEqual([null])
    expect(allowedReadings('< 0,5')).toEqual([null])
  })
})

describe('finalizeRows', () => {
  it('fila del informe con su valor en el renglón: queda como leída', () => {
    const [row] = finalizeRows([base], lines, new Set(['hemoglobina']))
    expect(row).toMatchObject({ status: 'read', isNewField: false, value: 13.5, printedValue: '13,5' })
  })

  it('la persona elige la lectura decimal de un valor ambiguo', () => {
    const [row] = finalizeRows([{ ...base, analyte: 'Leucocitos', printedValue: '7.300', value: 7.3, sourceLine: 2 }], lines, new Set())
    expect(row).toMatchObject({ value: 7.3, isNewField: true })
  })

  it('rechaza un valor que no está en el renglón citado', () => {
    expect(codeOf(() => finalizeRows([{ ...base, printedValue: '18,5', value: 18.5 }], lines, new Set()))).toBe('invalid_rows')
    expect(codeOf(() => finalizeRows([{ ...base, sourceLine: 40 }], lines, new Set()))).toBe('invalid_rows')
  })

  it('rechaza un número que no es una lectura del valor impreso', () => {
    expect(codeOf(() => finalizeRows([{ ...base, value: 135 }], lines, new Set()))).toBe('invalid_rows')
    expect(codeOf(() => finalizeRows([{ ...base, printedValue: 'Negativo', value: 0, sourceLine: null }], lines, new Set()))).toBe('invalid_rows')
  })

  it('una fila corregida a mano no cita renglón y queda marcada como manual', () => {
    const [row] = finalizeRows([{ ...base, printedValue: '18,5', value: 18.5, sourceLine: null }], lines, new Set())
    expect(row).toMatchObject({ status: 'manual', printedValue: '18,5', value: 18.5, sourceLine: null })
  })

  it('el catálogo no distingue mayúsculas ni acentos', () => {
    const [row] = finalizeRows([{ ...base, analyte: 'HEMOGLOBINA' }], lines, new Set(['hemoglobina']))
    expect(row?.isNewField).toBe(false)
  })
})

describe('entrada de la confirmación', () => {
  it('exige al menos una fila y rechaza campos de más', () => {
    expect(labConfirmSchema.safeParse({ rows: [] }).success).toBe(false)
    expect(labConfirmSchema.safeParse({ rows: [base] }).success).toBe(true)
    expect(labRowInputSchema.safeParse({ ...base, status: 'read' }).success).toBe(false)
    expect(labConfirmSchema.safeParse({ rows: [base], orgId: 'otra' }).success).toBe(false)
  })
  it('unidad y rango vacíos quedan en null', () => {
    const parsed = labRowInputSchema.parse({ ...base, unit: '  ', referenceRange: '' })
    expect(parsed.unit).toBeNull()
    expect(parsed.referenceRange).toBeNull()
  })
})
