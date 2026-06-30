import { describe, expect, it } from 'vitest'
import { detectPossiblePii } from '../phi-fields'

describe('detectPossiblePii', () => {
  it('flags email patterns', () => {
    const warnings = detectPossiblePii('Contacto: test@example.com')
    expect(warnings.some((w) => w.includes('email'))).toBe(true)
  })

  it('returns empty for clean clinical text', () => {
    expect(detectPossiblePii('Metformina 850mg. HbA1c 8.2%.')).toEqual([])
  })
})
