import { describe, expect, it } from 'vitest'
import { redactPhiForLlm } from '../phi-redact'

describe('redactPhiForLlm', () => {
  it('redacta DNI, email y teléfono argentino', () => {
    const input =
      'Paciente DNI 30123456 contacto juan@test.com tel +54 11 4444-5555. HbA1c 8.2%.'
    const { text, redactedCount } = redactPhiForLlm(input)
    expect(text).not.toContain('30123456')
    expect(text).not.toContain('juan@test.com')
    expect(text).not.toContain('4444-5555')
    expect(text).toContain('HbA1c 8.2%')
    expect(redactedCount).toBe(3)
  })

  it('no modifica texto sin identificadores', () => {
    const input = 'Paciente de 52 años. Metformina 850 mg. HbA1c 7.5%.'
    const { text, redactedCount } = redactPhiForLlm(input)
    expect(text).toBe(input)
    expect(redactedCount).toBe(0)
  })
})
