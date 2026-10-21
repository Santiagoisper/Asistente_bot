import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const modelFactory = vi.hoisted(() => ({
  createLanguageModel: vi.fn((provider: string) => ({ provider })),
}))

vi.mock('../provider', async () => {
  const actual = await vi.importActual<typeof import('../provider')>('../provider')
  return { ...actual, createLanguageModel: modelFactory.createLanguageModel }
})

import {
  isProviderFallbackError,
  isProviderQuotaError,
  runWithLlmFallback,
  statusFromError,
} from '../fallback'

/** Error como el que lanza el SDK de IA: el código HTTP va en `statusCode`, no en `status`. */
function apiCallError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { name: 'AI_APICallError', statusCode })
}

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GROQ_API_KEY', 'GLM_API_KEY', 'OPENAI_API_KEY']

beforeEach(() => {
  for (const name of ENV_KEYS) vi.stubEnv(name, '')
  vi.stubEnv('ZAI_API_KEY', '')
  vi.stubEnv('GOOGLE_API_KEY', '')
  modelFactory.createLanguageModel.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('detección de errores que justifican probar otro proveedor', () => {
  it('lee el código HTTP de statusCode (SDK de IA) y de status', () => {
    expect(statusFromError(apiCallError('x', 429))).toBe(429)
    expect(statusFromError(Object.assign(new Error('x'), { status: 401 }))).toBe(401)
    expect(statusFromError(new Error('x'))).toBeNull()
    expect(statusFromError('texto')).toBeNull()
  })

  it('reconoce el error real de Z.ai sin saldo (429 + mensaje)', () => {
    const err = apiCallError('Insufficient balance or no resource package. Please recharge.', 429)
    expect(isProviderQuotaError(err)).toBe(true)
    expect(isProviderFallbackError(err)).toBe(true)
  })

  it('reconoce el mensaje de saldo aunque no traiga código HTTP', () => {
    expect(isProviderQuotaError(new Error('Insufficient balance or no resource package'))).toBe(true)
  })

  it.each([401, 403, 500, 503])('el estado %s justifica pasar al siguiente proveedor', (status) => {
    expect(isProviderFallbackError(apiCallError('boom', status))).toBe(true)
  })

  it('un tiempo agotado justifica pasar al siguiente proveedor', () => {
    expect(isProviderFallbackError(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }))).toBe(true)
    expect(isProviderFallbackError(new Error('Request timed out'))).toBe(true)
  })

  it('un error de la propia petición (400) NO cambia de proveedor', () => {
    expect(isProviderFallbackError(apiCallError('Invalid request: bad schema', 400))).toBe(false)
    expect(isProviderFallbackError(new Error('Validation failed'))).toBe(false)
  })
})

describe('runWithLlmFallback', () => {
  it('pasa de GLM sin saldo al siguiente proveedor configurado', async () => {
    vi.stubEnv('GLM_API_KEY', 'glm-key')
    vi.stubEnv('GROQ_API_KEY', 'groq-key')
    const run = vi.fn(async (_model: unknown, provider: string) => {
      if (provider === 'glm') throw apiCallError('Insufficient balance or no resource package. Please recharge.', 429)
      return `respuesta de ${provider}`
    })

    const outcome = await runWithLlmFallback({ purpose: 'answer' }, run)

    expect(outcome.result).toBe('respuesta de groq')
    expect(outcome.provider).toBe('groq')
    expect(run.mock.calls.map((call) => call[1])).toEqual(['groq'])
  })

  it('respeta el orden de la cadena: Claude primero, y salta los que no tienen clave', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'a')
    vi.stubEnv('GROQ_API_KEY', 'g')
    const run = vi.fn(async (_model: unknown, provider: string) => provider)

    const outcome = await runWithLlmFallback({ purpose: 'answer' }, run)

    expect(outcome.provider).toBe('anthropic')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('recorre varios proveedores caídos hasta uno que responde', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'a')
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'g')
    vi.stubEnv('GROQ_API_KEY', 'q')
    const run = vi.fn(async (_model: unknown, provider: string) => {
      if (provider !== 'groq') throw apiCallError('rate limit', 429)
      return 'ok'
    })

    const outcome = await runWithLlmFallback({ purpose: 'spec' }, run)

    expect(outcome.provider).toBe('groq')
    expect(run.mock.calls.map((call) => call[1])).toEqual(['anthropic', 'google', 'groq'])
  })

  it('si fallan todos, propaga el error del último', async () => {
    vi.stubEnv('GROQ_API_KEY', 'q')
    vi.stubEnv('GLM_API_KEY', 'z')
    const run = vi.fn(async (_model: unknown, provider: string) => {
      throw apiCallError(`falló ${provider}`, 429)
    })

    await expect(runWithLlmFallback({ purpose: 'answer' }, run)).rejects.toThrow('falló glm')
  })

  it('un error que no es del proveedor (400) no se reintenta con otro', async () => {
    vi.stubEnv('GROQ_API_KEY', 'q')
    vi.stubEnv('GLM_API_KEY', 'z')
    const run = vi.fn(async () => {
      throw apiCallError('Invalid request', 400)
    })

    await expect(runWithLlmFallback({ purpose: 'answer' }, run)).rejects.toThrow('Invalid request')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('una preferencia concreta no cambia de proveedor aunque falle', async () => {
    vi.stubEnv('GROQ_API_KEY', 'q')
    vi.stubEnv('GLM_API_KEY', 'z')
    const run = vi.fn(async () => {
      throw apiCallError('rate limit', 429)
    })

    await expect(runWithLlmFallback({ purpose: 'answer', providerPreference: 'groq' }, run)).rejects.toThrow('rate limit')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('sin ninguna clave configurada falla con un mensaje claro', async () => {
    await expect(runWithLlmFallback({ purpose: 'answer' }, async () => 'x')).rejects.toThrow(/ningún proveedor/i)
  })

  it('no loguea el mensaje del error del proveedor (podría repetir texto del documento)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubEnv('GROQ_API_KEY', 'q')
    vi.stubEnv('GLM_API_KEY', 'z')
    const run = vi.fn(async (_model: unknown, provider: string) => {
      if (provider === 'groq') throw apiCallError('paciente con datos privados', 429)
      return 'ok'
    })

    await runWithLlmFallback({ purpose: 'answer' }, run)

    expect(JSON.stringify(warn.mock.calls)).not.toContain('paciente')
  })
})
