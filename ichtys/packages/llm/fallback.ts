import type { LanguageModel } from 'ai'
import {
  createLanguageModel,
  getDefaultProviderPreference,
  getModelId,
  isAnthropicConfigured,
  isGoogleConfigured,
} from './provider'
import type { LlmProviderId, LlmProviderPreference, LlmPurpose } from './types'

function statusFromError(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('status' in err)) return null
  const status = (err as { status: unknown }).status
  return typeof status === 'number' ? status : null
}

/** Errores por cuota, rate limit o sobrecarga — candidatos a fallback en modo `auto`. */
export function isProviderQuotaError(err: unknown): boolean {
  if (statusFromError(err) === 429) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /usage limits|rate limit|quota|resource_exhausted|overloaded|too many requests/i.test(
    msg,
  )
}

export interface RunWithLlmFallbackOptions {
  purpose: LlmPurpose
  providerPreference?: LlmProviderPreference
}

export interface LlmRunResult<T> {
  result: T
  provider: LlmProviderId
  modelId: string
}

/**
 * Ejecuta una llamada LLM con el proveedor elegido. En modo `auto`, si Claude
 * falla por cuota/rate limit y hay GOOGLE_GENERATIVE_AI_API_KEY, reintenta con Gemini.
 */
export async function runWithLlmFallback<T>(
  options: RunWithLlmFallbackOptions,
  run: (model: LanguageModel, provider: LlmProviderId) => Promise<T>,
): Promise<LlmRunResult<T>> {
  const preference = options.providerPreference ?? getDefaultProviderPreference()
  const providers: LlmProviderId[] =
    preference === 'auto' ? ['anthropic', 'google'] : [preference]

  let lastError: unknown

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!

    if (provider === 'google' && !isGoogleConfigured()) {
      if (preference === 'google') {
        throw new Error('GOOGLE_GENERATIVE_AI_API_KEY no está configurada.')
      }
      continue
    }
    if (provider === 'anthropic' && !isAnthropicConfigured()) {
      if (preference === 'anthropic') {
        throw new Error('ANTHROPIC_API_KEY no está configurada.')
      }
      continue
    }

    try {
      const model = createLanguageModel(provider, options.purpose)
      const result = await run(model, provider)
      return { result, provider, modelId: getModelId(provider, options.purpose) }
    } catch (err) {
      lastError = err
      const isLast = i === providers.length - 1
      const canFallback = preference === 'auto' && !isLast && isProviderQuotaError(err)
      if (canFallback) {
        console.warn(`[llm] ${provider} quota/rate error — trying fallback provider`)
        continue
      }
      throw err
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('No hay proveedor LLM disponible. Configurá ANTHROPIC_API_KEY o GOOGLE_GENERATIVE_AI_API_KEY.')
}
