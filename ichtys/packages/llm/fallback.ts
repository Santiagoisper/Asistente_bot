import type { LanguageModel } from 'ai'
import type { OrgLlmApiKeys } from './keys'
import {
  createLanguageModel,
  getModelId,
  isProviderConfigured,
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
 * Ejecuta una llamada generativa con GLM. Se conservan las opciones de proveedor
 * antiguas en la firma para compatibilidad, pero la aplicación ya no cambia de LLM.
 */
export async function runWithLlmFallback<T>(
  options: RunWithLlmFallbackOptions,
  run: (model: LanguageModel, provider: LlmProviderId) => Promise<T>,
): Promise<LlmRunResult<T>> {
  const provider = 'glm' as const
  if (!isProviderConfigured(provider, options.orgApiKeys)) {
    throw new Error('GLM no está configurado (falta GLM_API_KEY o la clave GLM de la organización).')
  }

  const model = createLanguageModel(provider, options.purpose, options.orgApiKeys)
  const result = await run(model, provider)
  return { result, provider, modelId: getModelId(provider, options.purpose, options.orgApiKeys) }
}
