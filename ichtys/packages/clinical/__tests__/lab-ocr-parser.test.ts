import { describe, expect, it } from 'vitest'
import { mergeConfirmedLabs, parseLabOcrText, redactLabHeaderPii } from '../lab-ocr-parser'

describe('parseLabOcrText — URS-007', () => {
  it('OQ-L06 — siempre requiresHumanReview', () => {
    const result = parseLabOcrText('HbA1c: 8.2 %')
    expect(result.requiresHumanReview).toBe(true)
  })

  it('extrae HbA1c y glucosa de texto tipo lab', () => {
    const text = `
      Paciente: Juan Pérez
      DNI: 30123456
      HbA1c: 8,2 %
      Glucosa en ayunas: 142 mg/dL
    `
    const result = parseLabOcrText(text)
    expect(result.labs.find((l) => l.name === 'HbA1c')?.value).toBe(8.2)
    expect(result.labs.find((l) => l.name === 'Glucosa')?.value).toBe(142)
    expect(result.piiRedactedCount).toBeGreaterThan(0)
    expect(result.redactedPreview).not.toContain('30123456')
  })

  it('redactLabHeaderPii oculta nombre de paciente', () => {
    const { text, redactedCount } = redactLabHeaderPii('Paciente: María López\nHbA1c 7.1%')
    expect(text).toContain('Paciente: [REDACTED]')
    expect(text).not.toContain('María')
    expect(redactedCount).toBeGreaterThan(0)
  })
})

describe('mergeConfirmedLabs', () => {
  it('upsert por nombre de analito', () => {
    const merged = mergeConfirmedLabs(
      [{ name: 'HbA1c', value: 7.0, unit: '%' }],
      [{ name: 'HbA1c', value: 8.2, unit: '%' }],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.value).toBe(8.2)
  })
})
