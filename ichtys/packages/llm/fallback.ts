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
  if (typeof err !== 'object' || err === null) return null
  // ai@4 expone statusCode en APICallError; los SDK directos usan status.
  const raw = (err as { status?: unknown; statusCode?: unknown })
  const status = raw.statusCode ?? raw.status
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

/** Por qué falló una llamada al modelo, en términos que se pueden dejar en un log. */
export interface LlmFailure {
  name: string
  status: number | null
  kind: 'quota_or_billing' | 'auth' | 'model_not_found' | 'timeout' | 'bad_request' | 'other'
  /** Palabras de una lista fija que aparecen en el mensaje del proveedor. Nunca el mensaje. */
  hints: string[]
}

/**
 * Palabras que alcanzan para orientar el diagnóstico de un pedido rechazado.
 * La lista es fija a propósito: el mensaje del proveedor puede repetir el
 * texto enviado, así que del mensaje solo sale si nombra alguna de estas.
 */
const FAILURE_HINTS = [
  'credit balance',
  'billing',
  'quota',
  'temperature',
  'max_tokens',
  'max_output_tokens',
  'context length',
  'too long',
  'schema',
  'tool',
  'response_format',
  'json',
  'deprecated',
  'not supported',
  'unsupported',
] as const

/**
 * Resume una falla del proveedor sin copiar su mensaje: código HTTP, categoría
 * y pistas de `FAILURE_HINTS`. Es lo que se escribe en el log cuando una
 * llamada falla, para poder saber la causa sin reproducirla.
 */
export function describeLlmFailure(err: unknown): LlmFailure {
  if (typeof err !== 'object' || err === null) return { name: typeof err, status: null, kind: 'other', hints: [] }
  const name = err instanceof Error && err.name ? err.name : 'Error'
  const status = statusFromError(err)
  const message = (err instanceof Error ? err.message : '').toLowerCase()
  const hints = FAILURE_HINTS.filter((hint) => message.includes(hint))

  let kind: LlmFailure['kind'] = 'other'
  if (err instanceof LlmCallTimeoutError || name === 'AbortError' || name === 'TimeoutError') kind = 'timeout'
  else if (isProviderQuotaError(err)) kind = 'quota_or_billing'
  else if (status === 401 || status === 403 || /invalid x-api-key|api key not valid|authentication|incorrect api key|unauthorized/.test(message)) kind = 'auth'
  else if (status === 404 || /model_not_found|does not exist|not found for api version/.test(message)) kind = 'model_not_found'
  else if (status === 400 || status === 422) kind = 'bad_request'
  return { name, status, kind, hints: [...hints] }
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
      // Diagnóstico sin el mensaje del proveedor (puede repetir el texto enviado).
      const failure = { purpose: options.purpose, provider, modelId: getModelId(provider, options.purpose), keySource, ...describeLlmFailure(err) }
      if (canFallback) {
        console.warn('[llm] provider failed — trying next provider', JSON.stringify(failure))
        continue
      }
      console.error('[llm] provider failed — no fallback', JSON.stringify(failure))
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
