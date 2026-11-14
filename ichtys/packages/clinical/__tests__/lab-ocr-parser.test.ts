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

  it('lee «Glucemia», que es como la informan los laboratorios de acá, y la guarda como Glucosa', () => {
    const result = parseLabOcrText('HbA1c: 7,8 %\nGlucemia: 132 mg/dL')
    expect(result.labs.find((l) => l.name === 'HbA1c')?.value).toBe(7.8)
    expect(result.labs.find((l) => l.name === 'Glucosa')).toEqual({ name: 'Glucosa', value: 132, unit: 'mg/dL' })
  })

  it.each([
    ['Glucemia en ayunas: 98 mg/dl', 98],
    ['GLUCEMIA BASAL 101', 101],
    ['Glicemia: 110 mg/dL', 110],
    ['Glucosa: 142 mg/dL', 142],
  ])('reconoce %s', (text, value) => {
    expect(parseLabOcrText(text).labs.find((l) => l.name === 'Glucosa')?.value).toBe(value)
  })

  it.each([
    ['Glucemia: 7,3 mmol/L', 'Glucosa', 7.3, 'mmol/L'],
    ['Glucemia: 0,98 g/L', 'Glucosa', 0.98, 'g/L'],
    ['Glucemia 98 mg%', 'Glucosa', 98, 'mg%'],
    ['Creatinina: 88 umol/L', 'Creatinina', 88, 'umol/L'],
    ['Creatinina: 88 µmol/L', 'Creatinina', 88, 'µmol/L'],
  ])('la unidad escrita manda: %s no se propone en mg/dL', (text, name, value, unit) => {
    expect(parseLabOcrText(text).labs.find((l) => l.name === name)).toEqual({ name, value, unit })
  })

  it.each([
    ['Glucemia: 132 mg/dl', 'Glucosa', 'mg/dL'],
    ['Glucemia: 132 MG/DL (VR 70-110)', 'Glucosa', 'mg/dL'],
    ['Creatinina 0,9 mg/dL', 'Creatinina', 'mg/dL'],
    ['eGFR: 62 mL/min/1,73m2', 'eGFR', 'mL/min'],
    ['HbA1c: 8,2 %', 'HbA1c', '%'],
  ])('la unidad habitual se guarda con su forma de siempre: %s', (text, name, unit) => {
    expect(parseLabOcrText(text).labs.find((l) => l.name === name)?.unit).toBe(unit)
  })

  it('una palabra después del número no es una unidad', () => {
    expect(parseLabOcrText('Glucemia 101 en ayunas').labs.find((l) => l.name === 'Glucosa')).toEqual({
      name: 'Glucosa',
      value: 101,
      unit: 'mg/dL',
    })
  })

  it('lee la HbA1c cuando el informe la pone entre paréntesis después del nombre largo', () => {
    const result = parseLabOcrText('Hemoglobina glicosilada (HbA1c): 7,8 %')
    expect(result.labs.find((l) => l.name === 'HbA1c')).toEqual({ name: 'HbA1c', value: 7.8, unit: '%' })
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
