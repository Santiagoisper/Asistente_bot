import { afterEach, describe, expect, it } from 'vitest'
import { isCabinaEnabled } from '../../flags'

const ENV_KEYS = ['VERCEL_ENV', 'ALPHI_CABINA'] as const

const previous: Record<(typeof ENV_KEYS)[number], string | undefined> = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  ALPHI_CABINA: process.env.ALPHI_CABINA,
}

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const key of ENV_KEYS) {
    if (!(key in values)) continue
    const value = values[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

afterEach(() => {
  setEnv(previous)
})

describe('bandera de la cabina', () => {
  it('en producción sin ALPHI_CABINA=on la ruta responde notFound y el menú no la muestra', () => {
    setEnv({ VERCEL_ENV: 'production', ALPHI_CABINA: undefined })
    expect(isCabinaEnabled()).toBe(false)

    for (const value of ['', 'off', 'ON', 'true', '1', ' on']) {
      setEnv({ VERCEL_ENV: 'production', ALPHI_CABINA: value })
      expect(isCabinaEnabled()).toBe(false)
    }
  })

  it('en producción con ALPHI_CABINA=on la ruta se renderiza y el menú la muestra', () => {
    setEnv({ VERCEL_ENV: 'production', ALPHI_CABINA: 'on' })
    expect(isCabinaEnabled()).toBe(true)
  })

  it('en preview, development y local se ve siempre, aunque la variable no esté o valga otra cosa', () => {
    for (const env of ['preview', 'development', undefined]) {
      setEnv({ VERCEL_ENV: env, ALPHI_CABINA: undefined })
      expect(isCabinaEnabled()).toBe(true)
      setEnv({ VERCEL_ENV: env, ALPHI_CABINA: 'off' })
      expect(isCabinaEnabled()).toBe(true)
    }
  })
})
