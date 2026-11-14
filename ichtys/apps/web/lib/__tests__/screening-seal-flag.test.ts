import { afterEach, describe, expect, it } from 'vitest'
import { isScreeningSealEnabled, SCREENING_SEAL_CLOSES_AT } from '../flags'

/**
 * La ruta de sellado (C3) es un trabajo que se hace una vez. Tiene fecha de baja: pasada esa
 * fecha no responde en ningún entorno, aunque alguien deje la variable encendida.
 */
const saved = { vercel: process.env.VERCEL_ENV, flag: process.env.ALPHI_SEAL_SCREENING }
const before = new Date('2026-11-20T12:00:00Z')

afterEach(() => {
  for (const [key, value] of [['VERCEL_ENV', saved.vercel], ['ALPHI_SEAL_SCREENING', saved.flag]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('isScreeningSealEnabled — la ruta de sellado y su fecha de baja', () => {
  it('fuera de producción está abierta hasta la fecha de baja', () => {
    process.env.VERCEL_ENV = 'preview'
    delete process.env.ALPHI_SEAL_SCREENING
    expect(isScreeningSealEnabled(before)).toBe(true)
  })

  it('en producción está cerrada salvo que alguien la encienda a propósito', () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.ALPHI_SEAL_SCREENING
    expect(isScreeningSealEnabled(before)).toBe(false)
    process.env.ALPHI_SEAL_SCREENING = 'true'
    expect(isScreeningSealEnabled(before)).toBe(false)
    process.env.ALPHI_SEAL_SCREENING = 'on'
    expect(isScreeningSealEnabled(before)).toBe(true)
  })

  it('pasada la fecha de baja está cerrada en todos lados, también con la variable encendida', () => {
    const after = new Date(SCREENING_SEAL_CLOSES_AT)
    process.env.VERCEL_ENV = 'preview'
    expect(isScreeningSealEnabled(after)).toBe(false)
    process.env.VERCEL_ENV = 'production'
    process.env.ALPHI_SEAL_SCREENING = 'on'
    expect(isScreeningSealEnabled(after)).toBe(false)
    expect(isScreeningSealEnabled(new Date(Date.parse(SCREENING_SEAL_CLOSES_AT) - 1))).toBe(true)
  })

  it('la fecha de baja es el 1 de enero de 2027', () => {
    expect(SCREENING_SEAL_CLOSES_AT).toBe('2027-01-01T00:00:00.000Z')
  })
})
