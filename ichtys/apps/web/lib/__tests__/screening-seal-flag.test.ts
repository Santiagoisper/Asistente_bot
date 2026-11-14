import { afterEach, describe, expect, it } from 'vitest'
import { SCREENING_SEAL_CLOSES_AT, screeningSealOperators } from '../flags'

/**
 * La ruta de sellado (C3) es un trabajo de quien responde por el sistema y se hace una vez.
 * La habilita una lista de operadores (ALPHI_SEAL_OPERATORS) y tiene fecha de baja: pasada
 * esa fecha no hay operadores en ningún entorno, aunque la variable siga cargada.
 */
const saved = process.env.ALPHI_SEAL_OPERATORS
const before = new Date('2026-11-20T12:00:00Z')

afterEach(() => {
  if (saved === undefined) delete process.env.ALPHI_SEAL_OPERATORS
  else process.env.ALPHI_SEAL_OPERATORS = saved
})

describe('screeningSealOperators — quién puede sellar, y hasta cuándo', () => {
  it('sin la variable no hay operadores: la ruta no existe en ningún entorno', () => {
    delete process.env.ALPHI_SEAL_OPERATORS
    expect(screeningSealOperators(before)).toEqual([])
    process.env.ALPHI_SEAL_OPERATORS = '  ,  , '
    expect(screeningSealOperators(before)).toEqual([])
  })

  it('lee los identificadores de usuario separados por coma, sin espacios ni repetidos', () => {
    process.env.ALPHI_SEAL_OPERATORS = ' user_a , user_b,user_a,'
    expect(screeningSealOperators(before)).toEqual(['user_a', 'user_b'])
  })

  it('pasada la fecha de baja no hay operadores, aunque la variable siga cargada', () => {
    process.env.ALPHI_SEAL_OPERATORS = 'user_a'
    expect(screeningSealOperators(new Date(SCREENING_SEAL_CLOSES_AT))).toEqual([])
    expect(screeningSealOperators(new Date(Date.parse(SCREENING_SEAL_CLOSES_AT) - 1))).toEqual(['user_a'])
  })

  it('la fecha de baja es el 1 de enero de 2027', () => {
    expect(SCREENING_SEAL_CLOSES_AT).toBe('2027-01-01T00:00:00.000Z')
  })
})
