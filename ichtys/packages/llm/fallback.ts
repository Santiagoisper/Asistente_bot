import type { LanguageModel } from 'ai'
import { getKeySourceForProvider, type OrgLlmApiKeys } from './keys'
import {
  createLanguageModel,
  getDefaultProviderPreference,
  getModelId,
  isProviderConfigured,
  resolveProviderChain,
} from './provider'
import type { LlmProviderId, LlmProviderPreference, LlmPurpose } from './types'

/** Tokens consumidos por una llamada real a un modelo (ver `packages/db/usage.ts`). */
export interface LlmUsage {
  inputTokens: number
  outputTokens: number
}

const ZERO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 }

/**
 * El cupo mensual de la organización está agotado y la llamada solo tenía disponible la
 * clave de la plataforma (ninguna clave propia de la org cubre un proveedor configurado).
 * El caller debe mostrar un mensaje claro: cargar clave propia o ampliar el plan.
 */
export class LlmQuotaExceededError extends Error {
  constructor() {
    super('Monthly platform quota exceeded for this organization.')
    this.name = 'LlmQuotaExceededError'
  }
}

/** Timeout propio de una llamada LLM (ver LLM_CALL_TIMEOUT_MS). */
export class LlmCallTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`LLM call timeout after ${ms}ms`)
    this.name = 'LlmCallTimeoutError'
  }
}

const DEFAULT_LLM_CALL_TIMEOUT_MS = 90_000

/**
 * Tope total por llamada LLM. Es la defensa de fondo: el SDK no trae un
 * timeout razonable por default y Vercel corta la función a los 300 s —
 * antes de ese corte, esta promesa ya rechazó (y el caller pudo caer al
 * siguiente proveedor o mostrar un error claro).
 */
function readLlmCallTimeoutMs(): number {
  const raw = Number(process.env.LLM_CALL_TIMEOUT_MS)
  return Number.isFinite(raw) && raw >= 10 ? raw : DEFAULT_LLM_CALL_TIMEOUT_MS
}

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

/** Errores que justifican probar el siguiente proveedor en la cadena. */
export function isProviderFallbackError(err: unknown): boolean {
  if (isProviderQuotaError(err)) return true
  if (err instanceof LlmCallTimeoutError) return true
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return true
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
  /**
   * Cupo mensual agotado: ignora la clave de la plataforma para cualquier proveedor —
   * solo sigue funcionando si la organización tiene su propia clave. Ver `LlmQuotaExceededError`.
   */
  platformKeyBlocked?: boolean
}

export interface LlmRunResult<T> {
  result: T
  provider: LlmProviderId
  modelId: string
  /** Tokens de la llamada real (0/0 si el callback nunca reportó uso). */
  usage: LlmUsage
  /** Quién paga esta llamada: clave propia de la organización o de la plataforma. */
  keySource: 'org' | 'platform' | 'none'
}

/**
 * Ejecuta una llamada LLM. En modo `auto` recorre:
 * Claude → OpenAI → Gemini → Groq → GLM hasta que uno responda.
 *
 * `run` recibe `reportUsage`: el callback debe invocarlo con los tokens reales
 * (`result.usage` de `generateText`/`generateObject`/`streamText`) antes de
 * devolver su resultado, para que el medidor de consumo (`@ichtys/db` usage.ts)
 * pueda registrar la llamada. Si no se llama, se asume 0/0 (no se registra nada).
 */
export async function runWithLlmFallback<T>(
  options: RunWithLlmFallbackOptions,
  run: (
    model: LanguageModel,
    provider: LlmProviderId,
    reportUsage: (usage: LlmUsage) => void,
    /** Se aborta a los LLM_CALL_TIMEOUT_MS — pasarlo como abortSignal del SDK. */
    signal: AbortSignal,
  ) => Promise<T>,
): Promise<LlmRunResult<T>> {
  const preference = options.providerPreference ?? getDefaultProviderPreference()
  const providers = resolveProviderChain(preference)

  let lastError: unknown
  let sawQuotaBlock = false

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!
    const configured = isProviderConfigured(provider, options.orgApiKeys)
    const keySource = configured ? getKeySourceForProvider(provider, options.orgApiKeys) : 'none'
    const quotaBlocksThis = Boolean(options.platformKeyBlocked) && keySource === 'platform'

    if (!configured || quotaBlocksThis) {
      if (quotaBlocksThis) sawQuotaBlock = true
      const isLast = i === providers.length - 1
      if (isLast) {
        if (sawQuotaBlock) throw new LlmQuotaExceededError()
        if (preference === provider) {
          throw new Error(`Proveedor ${provider} no configurado (falta API key en el servidor).`)
        }
      }
      continue
    }

    try {
      const model = createLanguageModel(provider, options.purpose, options.orgApiKeys)
      let usage: LlmUsage = ZERO_USAGE
      // Timeout propio por llamada: aborta el signal (para quien lo pase al SDK)
      // y corta el await aunque el callback lo ignore. Antes de esta defensa,
      // un proveedor colgado sostenía el request hasta el corte de 300 s de Vercel.
      const timeoutMs = readLlmCallTimeoutMs()
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new LlmCallTimeoutError(timeoutMs))
        }, timeoutMs)
      })
      let result: T
      try {
        result = await Promise.race([
          run(model, provider, (reported) => {
            usage = reported
          }, controller.signal),
          timeoutPromise,
        ])
      } finally {
        clearTimeout(timer)
      }
      return { result, provider, modelId: getModelId(provider, options.purpose), usage, keySource }
    } catch (err) {
      lastError = err
      const isLast = i === providers.length - 1
      // Con la cadena efectiva multi-proveedor (resolveProviderChain garantiza
      // respaldo Anthropic para toda preferencia explícita), el fallback ya no
      // se limita a 'auto': mientras quede alguien en la cadena, un error de
      // proveedor (cuota/auth/timeout) prueba al siguiente.
      const canFallback = !isLast && isProviderFallbackError(err)
      if (canFallback) {
        console.warn(`[llm] ${provider} failed — trying next provider (${(err as Error).message?.slice(0, 120)})`)
        continue
      }
      throw err
    }
  }

  if (sawQuotaBlock) throw new LlmQuotaExceededError()

  throw lastError instanceof Error
    ? lastError
    : new Error(
        'No hay proveedor LLM disponible. Configurá al menos una de: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY.',
      )
}
