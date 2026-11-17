import { describe, expect, it } from 'vitest'
import { sealTargetAllowedHere } from '../screening-seal'

/** Fuera de producción solo se sella una base de prueba conocida (hallazgo de Reviewer sobre #225). */
describe('sealTargetAllowedHere', () => {
  const TEST = 'ep-cool-snow-bf9xc6hw-pooler.c-5.us-west-2.aws.neon.tech/neondb'
  const OTHER = 'ep-otra-base-123456.c-5.us-west-2.aws.neon.tech/neondb'

  it('en producción, cualquier destino confirmado', () => {
    expect(sealTargetAllowedHere(OTHER, 'production')).toBe(true)
  })

  it.each(['preview', 'development', undefined])('en %s, solo la base de prueba conocida', (env) => {
    expect(sealTargetAllowedHere(TEST, env)).toBe(true)
    expect(sealTargetAllowedHere(TEST.replace('-pooler', ''), env)).toBe(true)
    expect(sealTargetAllowedHere(OTHER, env)).toBe(false)
  })

  it('un nombre que solo empieza igual no pasa', () => {
    expect(sealTargetAllowedHere('ep-cool-snow-bf9xc6hw-otra.neon.tech/neondb', 'preview')).toBe(false)
  })

  it('sin destino, nunca', () => {
    expect(sealTargetAllowedHere(null, 'production')).toBe(false)
  })
})
