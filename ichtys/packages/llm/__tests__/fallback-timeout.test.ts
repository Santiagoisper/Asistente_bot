import { afterEach, describe, expect, it, vi } from 'vitest'
import { LlmQuotaExceededError, runWithLlmFallback } from '../fallback'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const ORG_KEYS = { anthropic: 'sk-ant-org-1234567890', openai: 'sk-org-1234567890' } as const

describe('runWithLlmFallback — timeout propio (nunca esperar el corte de 300 s)', () => {
  it('una llamada que cuelga se corta a los LLM_CALL_TIMEOUT_MS', async () => {
    vi.stubEnv('LLM_CALL_TIMEOUT_MS', '50')
    const run = () => new Promise(() => {}) // cuelga para siempre
    await expect(
      runWithLlmFallback({ purpose: 'answer', orgApiKeys: ORG_KEYS }, run),
    ).rejects.toThrow(/timeout/i)
  })

  it('una llamada que cuelga cae al siguiente proveedor de la cadena', async () => {
    vi.stubEnv('LLM_CALL_TIMEOUT_MS', '50')
    vi.stubEnv('LLM_PROVIDER', 'openai') // cadena: openai → anthropic → ...
    let calls = 0
    const result = await runWithLlmFallback(
      { purpose: 'answer', orgApiKeys: ORG_KEYS },
      async (_model, provider, reportUsage) => {
        calls++
        if (provider === 'openai') {
          await new Promise(() => {}) // openai cuelga → timeout → fallback
        }
        reportUsage({ inputTokens: 10, outputTokens: 5 })
        return `ok-${provider}`
      },
    )
    expect(calls).toBe(2)
    expect(result.result).toBe('ok-anthropic')
    expect(result.provider).toBe('anthropic')
    expect(result.modelId).toBe('claude-sonnet-5-5')
  })

  it('el callback recibe un AbortSignal que se aborta al timeout', async () => {
    vi.stubEnv('LLM_CALL_TIMEOUT_MS', '50')
    let sawAborted = false
    await expect(
      runWithLlmFallback(
        { purpose: 'answer', orgApiKeys: ORG_KEYS },
        (_model, _provider, _reportUsage, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              sawAborted = true
              reject(new Error('aborted as expected'))
            })
          }),
      ),
    ).rejects.toThrow('aborted as expected')
    expect(sawAborted).toBe(true)
  })

  it('una llamada exitosa no se ve afectada por el timeout', async () => {
    vi.stubEnv('LLM_CALL_TIMEOUT_MS', '5000')
    const result = await runWithLlmFallback(
      { purpose: 'answer', orgApiKeys: ORG_KEYS },
      async (_model, _provider, reportUsage) => {
        reportUsage({ inputTokens: 3, outputTokens: 7 })
        return 'ok'
      },
    )
    expect(result.result).toBe('ok')
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 7 })
  })

  it('regresión: cuota agotada con preferencia explícita sigue lanzando LlmQuotaExceededError', async () => {
    // Determinista: la plataforma "tiene" clave anthropic (env), pero el cupo
    // de la org está agotado y la org no cargó clave propia.
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-platform-1234567890')
    await expect(
      runWithLlmFallback(
        { purpose: 'answer', providerPreference: 'anthropic', orgApiKeys: null, platformKeyBlocked: true },
        async () => 'no-debería-correr',
      ),
    ).rejects.toBeInstanceOf(LlmQuotaExceededError)
  })
})
