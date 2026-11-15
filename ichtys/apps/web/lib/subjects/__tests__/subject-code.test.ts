import { describe, expect, it } from 'vitest'
import { createSubjectSchema } from '../schemas'
import { SUBJECT_CODE_MESSAGES, subjectCodeFormatProblem } from '../subject-code'
import { subjectCodeProblem } from '../../labs/upload-form-state'

describe('formato del código de un sujeto', () => {
  it.each(['001-014', 'GZBO-001', 'ENSAYO-007', 'S01', 'a1', '1001-00023', 'AR01-0007-B'])('acepta el código de un estudio: %s', (code) => {
    expect(subjectCodeFormatProblem(code)).toBeNull()
    expect(createSubjectSchema.safeParse({ subjectCode: code }).success).toBe(true)
  })

  it.each(['30123456', '12', '0000000001', '-123', '123-', '12--34'])('frena lo que puede ser un documento: %s', (code) => {
    expect(subjectCodeFormatProblem(code)).toBe('only_digits')
    expect(createSubjectSchema.safeParse({ subjectCode: code }).success).toBe(false)
  })

  it.each(['JPG', 'PEREZ', 'Juan-Perez', 'AB'])('frena lo que puede ser un nombre o iniciales: %s', (code) => {
    expect(subjectCodeFormatProblem(code)).toBe('no_digit')
    expect(createSubjectSchema.safeParse({ subjectCode: code }).success).toBe(false)
  })

  it('conserva las reglas de antes: largo y caracteres', () => {
    expect(subjectCodeFormatProblem('')).toBe('empty')
    expect(subjectCodeFormatProblem('   ')).toBe('empty')
    expect(subjectCodeFormatProblem('1')).toBe('length')
    expect(subjectCodeFormatProblem(`A1${'0'.repeat(31)}`)).toBe('length')
    expect(subjectCodeFormatProblem('GZBO 001')).toBe('characters')
    expect(subjectCodeFormatProblem('GZBO_001')).toBe('characters')
  })

  it('la pantalla dice lo mismo que el servidor, con un ejemplo', () => {
    expect(subjectCodeProblem('30123456')).toBe(SUBJECT_CODE_MESSAGES.only_digits)
    expect(subjectCodeProblem('JPG')).toBe(SUBJECT_CODE_MESSAGES.no_digit)
    expect(subjectCodeProblem(' GZBO-001 ')).toBeNull()
    expect(SUBJECT_CODE_MESSAGES.only_digits).toContain('001-014')
  })

  it('declara lo que no frena: iniciales con un número', () => {
    expect(subjectCodeFormatProblem('JP-1973')).toBeNull()
  })
})
