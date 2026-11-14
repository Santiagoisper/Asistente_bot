import { encryptPhiField } from '@ichtys/crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PhiConfigError } from '../phi-fields'
import { isSealedScreeningJson, openScreeningJson, sealScreeningJson } from '../screening-crypto'

/**
 * C3: lo que se guarda de una evaluación de elegibilidad va cifrado. El motivo de cada
 * criterio cita valores del sujeto («HbA1c 7,9 % ≥ 7,0 %…»): es dato clínico.
 */
const KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)
const OTHER_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'.repeat(2)
const savedKey = process.env.PHI_ENCRYPTION_KEY
const ASSESSMENTS = [{ criterionNumber: '3', criterionText: 'HbA1c 7,0–10,5 %', kind: 'inclusion', status: 'pass', reason: 'HbA1c 7,9 % ≥ 7,0 % (mínimo inclusivo)', sourcePages: [12] }]
const SUMMARY = { pass: 1, fail: 0, unknown: 0 }

beforeAll(() => {
  process.env.PHI_ENCRYPTION_KEY = KEY
})
beforeEach(() => {
  process.env.PHI_ENCRYPTION_KEY = KEY
})
afterAll(() => {
  if (savedKey === undefined) delete process.env.PHI_ENCRYPTION_KEY
  else process.env.PHI_ENCRYPTION_KEY = savedKey
})

describe('sealScreeningJson — lo que va a la base', () => {
  it('es un sobre con su marca y el texto cifrado; nada del contenido queda legible', () => {
    const sealed = sealScreeningJson(ASSESSMENTS)
    expect(Object.keys(sealed).sort()).toEqual(['ciphertext', 'enc'])
    expect(sealed.enc).toBe('phi.v1')
    expect(sealed.ciphertext.startsWith('v1:')).toBe(true)
    const stored = JSON.stringify(sealed)
    for (const fragment of ['HbA1c', '7,9', 'inclusion', 'pass', 'mínimo']) expect(stored).not.toContain(fragment)
  })

  it('abrir lo sellado devuelve lo mismo', () => {
    expect(openScreeningJson(sealScreeningJson(ASSESSMENTS))).toEqual({ ok: true, value: ASSESSMENTS })
    expect(openScreeningJson(sealScreeningJson(SUMMARY))).toEqual({ ok: true, value: SUMMARY })
  })
})

describe('openScreeningJson — leer lo guardado', () => {
  it('una fila anterior al cifrado (la lista o el resumen en claro) se lee tal cual', () => {
    expect(isSealedScreeningJson(ASSESSMENTS)).toBe(false)
    expect(isSealedScreeningJson(SUMMARY)).toBe(false)
    expect(openScreeningJson(ASSESSMENTS)).toEqual({ ok: true, value: ASSESSMENTS })
    expect(openScreeningJson(SUMMARY)).toEqual({ ok: true, value: SUMMARY })
  })

  it.each([
    ['el texto cifrado no tiene el formato', { enc: 'phi.v1', ciphertext: 'no-es-cifrado' }],
    ['descifra y no es JSON', () => ({ enc: 'phi.v1', ciphertext: encryptPhiField('HbA1c 7,9 %', KEY) })],
  ])('un sobre roto (%s) no se puede leer, y no es un error', (_label, stored) => {
    expect(openScreeningJson(typeof stored === 'function' ? stored() : stored)).toEqual({ ok: false })
  })

  it('un sobre cifrado con otra clave es un problema del entorno: error de configuración', () => {
    const foreign = { enc: 'phi.v1', ciphertext: encryptPhiField(JSON.stringify(ASSESSMENTS), OTHER_KEY) }
    expect(() => openScreeningJson(foreign)).toThrow(PhiConfigError)
  })

  it('sin clave de cifrado: error de configuración al sellar y al abrir', () => {
    const sealed = sealScreeningJson(ASSESSMENTS)
    delete process.env.PHI_ENCRYPTION_KEY
    expect(() => sealScreeningJson(ASSESSMENTS)).toThrow(PhiConfigError)
    expect(() => openScreeningJson(sealed)).toThrow(PhiConfigError)
  })

  it('una marca de sobre que este código no conoce no se trata como fila en claro', () => {
    expect(openScreeningJson({ enc: 'phi.v9', ciphertext: 'x' })).toEqual({ ok: false })
  })
})
