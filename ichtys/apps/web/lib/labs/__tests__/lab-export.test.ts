import { describe, expect, it } from 'vitest'
import { downloadName, exportFileName, labReportCsv, labRowsForClipboard } from '../lab-export'

const row = (analyte: string, printedValue: string, value: number | null, unit: string | null = null, referenceRange: string | null = null) => ({ analyte, printedValue, value, unit, referenceRange })
const REPORT = '33333333-3333-4333-8333-333333333333'
const meta = { studyLabel: 'ABC-301', subjectCode: '001-014', reportId: REPORT, reviewedAt: new Date('2026-11-11T15:30:00.000Z'), timeZone: 'America/Argentina/Buenos_Aires' }

describe('exportación de un estudio revisado', () => {
  it('arma un CSV que Excel abre bien: BOM, punto y coma, y el valor tal cual está impreso', () => {
    const csv = labReportCsv({ ...meta, rows: [row('Hemoglobina', '13,5', 13.5, 'g/dL', '12,0 - 16,0'), row('Leucocitos', '7.200', 7200, '/mm3')] })
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Estudio;Sujeto;Analito;Valor impreso;Valor numérico;Unidad;Referencia;Revisado;Informe')
    expect(lines[1]).toBe('ABC-301;001-014;Hemoglobina;13,5;13,5;g/dL;12,0 - 16,0;2026-11-11 12:30;33333333')
    expect(lines[2]).toBe('ABC-301;001-014;Leucocitos;7.200;7200;/mm3;;2026-11-11 12:30;33333333')
    expect(lines).toHaveLength(4)
    expect(lines[3]).toBe('')
  })

  it('un resultado de texto no inventa un número', () => {
    const csv = labReportCsv({ ...meta, rows: [row('VDRL', 'No reactivo', null)] })
    expect(csv.split('\r\n')[1]).toBe('ABC-301;001-014;VDRL;No reactivo;;;;2026-11-11 12:30;33333333')
  })

  it('escapa separadores, comillas y saltos de línea', () => {
    const csv = labReportCsv({ ...meta, rows: [row('Colesterol; total', '168', 168, 'mg/dL', 'Deseable: "menor" de 200\nLímite: 200-239')] })
    expect(csv.split('\r\n')[1]).toBe('ABC-301;001-014;"Colesterol; total";168;168;mg/dL;"Deseable: ""menor"" de 200 Límite: 200-239";2026-11-11 12:30;33333333')
  })

  it('una celda que una planilla ejecutaría como fórmula sale como texto', () => {
    const csv = labReportCsv({ ...meta, rows: [row('=HYPERLINK("http://x")', '+cmd|x', null, '@unidad'), row('-nombre', '-2+3+cmd', null)] })
    const lines = csv.split('\r\n')
    expect(lines[1]).toBe(`ABC-301;001-014;"'=HYPERLINK(""http://x"")";'+cmd|x;;'@unidad;;2026-11-11 12:30;33333333`)
    expect(lines[2]).toBe("ABC-301;001-014;'-nombre;'-2+3+cmd;;;;2026-11-11 12:30;33333333")
  })

  it('un resultado con signo no es una fórmula: sale tal cual está impreso', () => {
    const csv = labReportCsv({ ...meta, rows: [row('Temperatura', '-2,5', -2.5), row('Exceso de base', '+5', 5), row('Proteínas en orina', '++', null), row('Cetonas', '-', null)] })
    const values = csv.split('\r\n').slice(1, 5).map((line) => line.split(';')[3])
    expect(values).toEqual(['-2,5', '+5', '++', '-'])
  })

  it('el estudio también se limpia: es texto que escribió una persona', () => {
    const csv = labReportCsv({ ...meta, studyLabel: '=Estudio; fase 3', rows: [row('Glucosa', '92', 92)] })
    expect(csv.split('\r\n')[1]!.startsWith(`"'=Estudio; fase 3";001-014;`)).toBe(true)
  })

  it('sin fecha de revisión deja la columna vacía', () => {
    expect(labReportCsv({ ...meta, reviewedAt: null, rows: [row('Glucosa', '92', 92)] }).split('\r\n')[1]).toBe('ABC-301;001-014;Glucosa;92;92;;;;33333333')
  })

  it('para pegar en otra pantalla: una fila por analito, con tabulaciones y el valor impreso', () => {
    expect(labRowsForClipboard([row('Hemoglobina', '13,5', 13.5, 'g/dL'), row('VDRL', 'No\treactivo', null)])).toBe('Hemoglobina\t13,5\tg/dL\nVDRL\tNo reactivo\t')
    // Pegado en una planilla tampoco se ejecuta; un valor con signo queda intacto.
    expect(labRowsForClipboard([row('=SUM(A1)', '++', null, '@x'), row('Exceso de base', '-3,1', -3.1)])).toBe("'=SUM(A1)\t++\t'@x\nExceso de base\t-3,1\t")
  })

  it('el nombre del archivo distingue estudio, sujeto, día e informe, sin caracteres raros', () => {
    const at = new Date('2026-11-11T15:30:00.000Z')
    const tz = 'America/Argentina/Buenos_Aires'
    expect(exportFileName({ studyLabel: 'ABC-301', subjectCode: '001-014', reportId: REPORT, reviewedAt: at, timeZone: tz })).toBe('laboratorio-ABC-301-001-014-2026-11-11-33333333.csv')
    // Dos informes del mismo sujeto el mismo día no se pisan.
    expect(exportFileName({ studyLabel: 'ABC-301', subjectCode: '001-014', reportId: '44444444-4444-4444-8444-444444444444', reviewedAt: at, timeZone: tz })).toBe('laboratorio-ABC-301-001-014-2026-11-11-44444444.csv')
    expect(exportFileName({ studyLabel: 'Estudio de diabetes: fase 3', subjectCode: '../../etc/passwd', reportId: REPORT, reviewedAt: null, timeZone: tz })).toBe('laboratorio-Estudiodediabetesfase3-etcpasswd-33333333.csv')
  })

  it('el navegador toma el nombre que mandó el servidor, y si no vino usa uno seguro', () => {
    expect(downloadName('attachment; filename="laboratorio-ABC-301-001-014-2026-11-11-33333333.csv"')).toBe('laboratorio-ABC-301-001-014-2026-11-11-33333333.csv')
    expect(downloadName(null)).toBe('laboratorio.csv')
    expect(downloadName('attachment')).toBe('laboratorio.csv')
    expect(downloadName('attachment; filename="../../x.exe"')).toBe('laboratorio.csv')
  })
})
