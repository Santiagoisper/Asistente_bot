import { describe, expect, it } from 'vitest'
import { downloadName, exportFileName, labReportCsv, labRowsForClipboard } from '../lab-export'

const row = (analyte: string, printedValue: string, value: number | null, unit: string | null = null, referenceRange: string | null = null) => ({ analyte, printedValue, value, unit, referenceRange })
const meta = { subjectCode: '001-014', reviewedAt: new Date('2026-11-11T15:30:00.000Z'), timeZone: 'America/Argentina/Buenos_Aires' }

describe('exportación de un estudio revisado', () => {
  it('arma un CSV que Excel abre bien: BOM, punto y coma, y el valor tal cual está impreso', () => {
    const csv = labReportCsv({ ...meta, rows: [row('Hemoglobina', '13,5', 13.5, 'g/dL', '12,0 - 16,0'), row('Leucocitos', '7.200', 7200, '/mm3')] })
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Sujeto;Analito;Valor impreso;Valor numérico;Unidad;Referencia;Revisado')
    expect(lines[1]).toBe('001-014;Hemoglobina;13,5;13,5;g/dL;12,0 - 16,0;2026-11-11 12:30')
    expect(lines[2]).toBe('001-014;Leucocitos;7.200;7200;/mm3;;2026-11-11 12:30')
    expect(lines).toHaveLength(4)
    expect(lines[3]).toBe('')
  })

  it('un resultado de texto no inventa un número', () => {
    const csv = labReportCsv({ ...meta, rows: [row('VDRL', 'No reactivo', null)] })
    expect(csv.split('\r\n')[1]).toBe('001-014;VDRL;No reactivo;;;;2026-11-11 12:30')
  })

  it('escapa separadores, comillas y saltos de línea', () => {
    const csv = labReportCsv({ ...meta, rows: [row('Colesterol; total', '168', 168, 'mg/dL', 'Deseable: "menor" de 200\nLímite: 200-239')] })
    expect(csv.split('\r\n')[1]).toBe('001-014;"Colesterol; total";168;168;mg/dL;"Deseable: ""menor"" de 200 Límite: 200-239";2026-11-11 12:30')
  })

  it('una celda que una planilla ejecutaría como fórmula sale como texto', () => {
    const csv = labReportCsv({ ...meta, rows: [row('=HYPERLINK("http://x")', '+5', 5, '@unidad'), row('Temperatura', '-2,5', -2.5), row('-nombre', '10', 10)] })
    const lines = csv.split('\r\n')
    expect(lines[1]).toBe(`001-014;"'=HYPERLINK(""http://x"")";'+5;5;'@unidad;;2026-11-11 12:30`)
    // Un número negativo no es una fórmula.
    expect(lines[2]).toBe('001-014;Temperatura;-2,5;-2,5;;;2026-11-11 12:30')
    expect(lines[3]!.startsWith("001-014;'-nombre;")).toBe(true)
  })

  it('sin fecha de revisión deja la columna vacía', () => {
    expect(labReportCsv({ ...meta, reviewedAt: null, rows: [row('Glucosa', '92', 92)] }).split('\r\n')[1]).toBe('001-014;Glucosa;92;92;;;')
  })

  it('para pegar en otra pantalla: una fila por analito, con tabulaciones y el valor impreso', () => {
    expect(labRowsForClipboard([row('Hemoglobina', '13,5', 13.5, 'g/dL'), row('VDRL', 'No\treactivo', null)])).toBe('Hemoglobina\t13,5\tg/dL\nVDRL\tNo reactivo\t')
  })

  it('el nombre del archivo lleva el código del sujeto y la fecha, sin caracteres raros', () => {
    expect(exportFileName('001-014', new Date('2026-11-11T15:30:00.000Z'), 'America/Argentina/Buenos_Aires')).toBe('laboratorio-001-014-2026-11-11.csv')
    expect(exportFileName('../../etc/passwd', null, 'America/Argentina/Buenos_Aires')).toBe('laboratorio-etcpasswd.csv')
  })

  it('el navegador toma el nombre que mandó el servidor, y si no vino usa uno seguro', () => {
    expect(downloadName('attachment; filename="laboratorio-001-014-2026-11-11.csv"')).toBe('laboratorio-001-014-2026-11-11.csv')
    expect(downloadName(null)).toBe('laboratorio.csv')
    expect(downloadName('attachment')).toBe('laboratorio.csv')
    expect(downloadName('attachment; filename="../../x.exe"')).toBe('laboratorio.csv')
  })
})
