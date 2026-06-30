import type { LanguageModel } from 'ai'
import type { OrgLlmApiKeys } from './keys'
import {
  createLanguageModel,
  getDefaultProviderPreference,
  getModelId,
  isProviderConfigured,
  resolveProviderChain,
} from './provider'
import type { LlmProviderId, LlmProviderPreference, LlmPurpose } from './types'

function statusFromError(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('status' in err)) return null
  const status = (err as { status: unknown }).status
  return typeof status === 'number' ? status : null
}

/** Errores por cuota, rate limit o sobrecarga. */
export function isProviderQuotaError(err: unknown): boolean {
  if (statusFromError(err) === 429) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /usage limits|rate limit|quota|resource_exhausted|overloaded|too many requests|exceeded your current quota|insufficient_quota|billing|credit balance|spending limit/i.test(
    msg,
  )
}

/** Errores que justifican probar el siguiente proveedor en modo `auto`. */
export function isProviderFallbackError(err: unknown): boolean {
  if (isProviderQuotaError(err)) return true
  if (statusFromError(err) === 401 || statusFromError(err) === 403) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /invalid x-api-key|api key not valid|authentication|incorrect api key|unauthorized|model_not_found|does not exist|not found for api version/i.test(
    msg,
  )
}

export interface RunWithLlmFallbackOptions {
  purpose: LlmPurpose
  providerPreference?: LlmProviderPreference
  orgApiKeys?: OrgLlmApiKeys | null
}

export interface LlmRunResult<T> {
  result: T
  provider: LlmProviderId
  modelId: string
}

/**
 * Ejecuta una llamada LLM. En modo `auto` recorre:
 * Claude → OpenAI → Gemini → Groq → GLM hasta que uno responda.
 */
export async function runWithLlmFallback<T>(
  options: RunWithLlmFallbackOptions,
  run: (model: LanguageModel, provider: LlmProviderId) => Promise<T>,
): Promise<LlmRunResult<T>> {
  const preference = options.providerPreference ?? getDefaultProviderPreference()
  const providers = resolveProviderChain(preference)

  let lastError: unknown

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!

    if (!isProviderConfigured(provider, options.orgApiKeys)) {
      if (preference === provider) {
        throw new Error(`Proveedor ${provider} no configurado (falta API key en el servidor).`)
      }
      continue
    }

    try {
      const model = createLanguageModel(provider, options.purpose, options.orgApiKeys)
      const result = await run(model, provider)
      return { result, provider, modelId: getModelId(provider, options.purpose) }
    } catch (err) {
      lastError = err
      const isLast = i === providers.length - 1
      const canFallback = preference === 'auto' && !isLast && isProviderFallbackError(err)
      if (canFallback) {
        console.warn(`[llm] ${provider} failed — trying next provider (${(err as Error).message?.slice(0, 120)})`)
        continue
      }
      throw err
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
        'No hay proveedor LLM disponible. Configurá al menos una de: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY.',
      )
}
