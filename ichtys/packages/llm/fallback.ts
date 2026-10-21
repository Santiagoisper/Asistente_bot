import type { LanguageModel } from 'ai'
import type { OrgLlmApiKeys } from './keys'
import {
  createLanguageModel,
  getModelId,
  isProviderConfigured,
  resolveProviderChain,
} from './provider'
import type { LlmProviderId, LlmProviderPreference, LlmPurpose } from './types'

/**
 * Código HTTP de un error de proveedor. El SDK de IA (APICallError) lo guarda como `statusCode`;
 * otros clientes usan `status`. Se leen los dos.
 */
export function statusFromError(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null
  const record = err as { status?: unknown; statusCode?: unknown }
  if (typeof record.status === 'number') return record.status
  if (typeof record.statusCode === 'number') return record.statusCode
  return null
}

/** Errores por cuota, saldo, rate limit o sobrecarga. */
export function isProviderQuotaError(err: unknown): boolean {
  if (statusFromError(err) === 429) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /usage limits|rate limit|quota|resource_exhausted|overloaded|too many requests|exceeded your current quota|insufficient_quota|insufficient balance|no resource package|please recharge|billing|credit balance|spending limit/i.test(
    msg,
  )
}

/** Errores que justifican probar el siguiente proveedor en modo `auto`. */
export function isProviderFallbackError(err: unknown): boolean {
  if (isProviderQuotaError(err)) return true
  const status = statusFromError(err)
  if (status === 401 || status === 403 || (status !== null && status >= 500)) return true
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /invalid x-api-key|api key not valid|authentication|incorrect api key|unauthorized|model_not_found|does not exist|not found for api version|timed out|timeout|aborted/i.test(
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
 * Ejecuta una llamada generativa recorriendo la cadena de proveedores configurados. En modo
 * `auto` (por defecto) un fallo de saldo/cuota/clave/tiempo pasa al siguiente; cualquier otro
 * error se propaga. Una preferencia concreta usa solo ese proveedor.
 *
 * No se loguea el mensaje del error: puede repetir texto del documento (posible PHI).
 */
export async function runWithLlmFallback<T>(
  options: RunWithLlmFallbackOptions,
  run: (model: LanguageModel, provider: LlmProviderId) => Promise<T>,
): Promise<LlmRunResult<T>> {
  const auto = (options.providerPreference ?? 'auto') === 'auto'
  const chain = resolveProviderChain(options.providerPreference).filter((provider) =>
    isProviderConfigured(provider, options.orgApiKeys),
  )

  if (chain.length === 0) {
    throw new Error('No hay ningún proveedor de IA configurado (faltan las claves de API).')
  }

  let lastError: unknown
  for (let i = 0; i < chain.length; i += 1) {
    const provider = chain[i]
    if (!provider) continue
    try {
      const model = createLanguageModel(provider, options.purpose, options.orgApiKeys)
      const result = await run(model, provider)
      return { result, provider, modelId: getModelId(provider, options.purpose, options.orgApiKeys) }
    } catch (err) {
      lastError = err
      const isLast = i === chain.length - 1
      if (!auto || isLast || !isProviderFallbackError(err)) throw err
      console.warn(`[llm-fallback] ${provider} failed (status=${statusFromError(err) ?? 'n/a'}) — trying next provider`)
    }
  }

  throw lastError
}
