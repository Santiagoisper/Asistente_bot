import { describe, expect, it } from 'vitest'
import { labReportContentSchema } from '../lab-report-content'

/**
 * C4 paso 1 (lector tolerante): labReportContentSchema es .strict() con
 * version literal 1. sampleDate entra como campo opcional de la versión 1
 * para que los informes ya guardados sigan abriendo y los que traigan fecha
 * (cuando el paso 3 la escriba) no rompan una vuelta atrás.
 */
const baseContent = {
  version: 1,
  fileName: 'informe.pdf',
  transcription: 'Fecha de extracción: 24/09/2026\nGlucosa 98 mg/dL',
  unparsedLines: [] as number[],
  piiRedactedCount: 3,
  rows: [] as unknown[],
}

describe('labReportContentSchema — lector tolerante a sampleDate (C4 paso 1)', () => {
  it('un informe guardado antes del cambio (sin sampleDate) sigue abriendo', () => {
    const parsed = labReportContentSchema.safeParse(baseContent)
    expect(parsed.success).toBe(true)
  })

  it('acepta sampleDate YYYY-MM-DD y la devuelve exacta', () => {
    const parsed = labReportContentSchema.safeParse({
      ...baseContent,
      sampleDate: '2026-09-24',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.sampleDate).toBe('2026-09-24')
  })

  it('acepta sampleDate null: se miró el informe y no trae fecha de muestra', () => {
    const parsed = labReportContentSchema.safeParse({
      ...baseContent,
      sampleDate: null,
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.sampleDate).toBe(null)
  })

  it('rechaza sampleDate en otro formato (24/09/2026)', () => {
    const parsed = labReportContentSchema.safeParse({
      ...baseContent,
      sampleDate: '24/09/2026',
    })
    expect(parsed.success).toBe(false)
  })

  it('sigue rechazando claves desconocidas: solo se abrió sampleDate', () => {
    const parsed = labReportContentSchema.safeParse({
      ...baseContent,
      sampleDates: ['2026-09-24'],
    })
    expect(parsed.success).toBe(false)
  })
})
