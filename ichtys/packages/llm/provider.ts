import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { resolveKeyForProvider } from './keys'
import type { OrgLlmApiKeys } from './keys'
import { AUTO_PROVIDER_CHAIN, KNOWN_PROVIDERS, type LlmProviderId, type LlmProviderPreference, type LlmPurpose } from './types'

export type { OrgLlmApiKeys }

export function getDefaultProviderPreference(): LlmProviderPreference {
  return 'auto'
}

export function isProviderConfigured(
  provider: LlmProviderId,
  orgKeys?: OrgLlmApiKeys | null,
): boolean {
  return Boolean(resolveKeyForProvider(provider, orgKeys))
}

export function isAnthropicConfigured(orgKeys?: OrgLlmApiKeys | null): boolean {
  return isProviderConfigured('anthropic', orgKeys)
}

export function isOpenAiConfigured(orgKeys?: OrgLlmApiKeys | null): boolean {
  return isProviderConfigured('openai', orgKeys)
}

export function isGoogleConfigured(orgKeys?: OrgLlmApiKeys | null): boolean {
  return isProviderConfigured('google', orgKeys)
}

export function isGroqConfigured(orgKeys?: OrgLlmApiKeys | null): boolean {
  return isProviderConfigured('groq', orgKeys)
}

export function isGlmConfigured(orgKeys?: OrgLlmApiKeys | null): boolean {
  return isProviderConfigured('glm', orgKeys)
}

/** Cadena por variable de entorno LLM_PROVIDER_CHAIN; ignora nombres desconocidos y repetidos. */
function chainFromEnv(): LlmProviderId[] | null {
  const raw = process.env.LLM_PROVIDER_CHAIN?.trim()
  if (!raw) return null
  const valid = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is LlmProviderId => (KNOWN_PROVIDERS as readonly string[]).includes(item))
  const unique = [...new Set(valid)]
  return unique.length > 0 ? unique : null
}

export function resolveProviderChain(preference?: LlmProviderPreference): LlmProviderId[] {
  if (preference && preference !== 'auto') return [preference]
  return chainFromEnv() ?? [...AUTO_PROVIDER_CHAIN]
}

export function resolvePrimaryProvider(
  preference?: LlmProviderPreference,
  orgKeys?: OrgLlmApiKeys | null,
): LlmProviderId | null {
  for (const provider of resolveProviderChain(preference)) {
    if (isProviderConfigured(provider, orgKeys)) return provider
  }
  return null
}

export function getModel(
  purpose: LlmPurpose = 'answer',
  orgKeys?: OrgLlmApiKeys | null,
): LanguageModel {
  const provider = resolvePrimaryProvider('auto', orgKeys)
  if (!provider) {
    throw new Error('No hay proveedor LLM configurado para esta organización.')
  }
  return createLanguageModel(provider, purpose, orgKeys)
}

export function getModelId(
  provider: LlmProviderId,
  purpose: LlmPurpose,
  _orgKeys?: OrgLlmApiKeys | null,
): string {
  switch (provider) {
    case 'anthropic':
      if (purpose === 'title' || purpose === 'clinical-extract') {
        return process.env.TITLE_MODEL ?? 'claude-haiku-5-5'
      }
      // Extraer el protocolo es lo más sensible a errores y ocurre una vez por documento: modelo mayor.
      if (purpose === 'spec') return process.env.SPEC_EXTRACTION_MODEL ?? 'claude-sonnet-5-5'
      // Chat: Haiku, rápido y barato; se puede subir a Sonnet con ANSWER_MODEL sin redeploy de código.
      return process.env.ANSWER_MODEL ?? 'claude-haiku-5-5'
    case 'openai':
      if (purpose === 'title' || purpose === 'clinical-extract') {
        return process.env.OPENAI_TITLE_MODEL ?? 'gpt-4o-mini'
      }
      if (purpose === 'spec') {
        return process.env.SPEC_EXTRACTION_MODEL_OPENAI ?? process.env.OPENAI_ANSWER_MODEL ?? 'gpt-4o'
      }
      return process.env.OPENAI_ANSWER_MODEL ?? process.env.ANSWER_MODEL_OPENAI ?? 'gpt-4o'
    case 'google':
      if (purpose === 'title' || purpose === 'clinical-extract') {
        return process.env.GOOGLE_TITLE_MODEL ?? process.env.GEMINI_TITLE_MODEL ?? 'gemini-flash-latest'
      }
      if (purpose === 'spec') {
        return (
          process.env.SPEC_EXTRACTION_MODEL_GEMINI ??
          process.env.GEMINI_ANSWER_MODEL ??
          'gemini-flash-latest'
        )
      }
      return process.env.GEMINI_ANSWER_MODEL ?? process.env.GOOGLE_ANSWER_MODEL ?? 'gemini-flash-latest'
    case 'groq':
      if (purpose === 'title' || purpose === 'clinical-extract') {
        return process.env.GROQ_TITLE_MODEL ?? 'llama-3.1-8b-instant'
      }
      if (purpose === 'spec') {
        return process.env.SPEC_EXTRACTION_MODEL_GROQ ?? process.env.GROQ_ANSWER_MODEL ?? 'llama-3.3-70b-versatile'
      }
      return process.env.GROQ_ANSWER_MODEL ?? 'llama-3.3-70b-versatile'
    case 'glm':
    {
      const defaultModel = 'glm-5.3'
      if (purpose === 'title' || purpose === 'clinical-extract') {
        return process.env.GLM_TITLE_MODEL ?? process.env.GLM_MODEL ?? defaultModel
      }
      if (purpose === 'spec') {
        return process.env.SPEC_EXTRACTION_MODEL_GLM ?? process.env.GLM_MODEL ?? defaultModel
      }
      return process.env.GLM_ANSWER_MODEL ?? process.env.GLM_MODEL ?? defaultModel
    }
  }
}

export function getGlmBaseUrl(_orgKeys?: OrgLlmApiKeys | null): string {
  return process.env.GLM_BASE_URL?.trim() || 'https://api.z.ai/api/paas/v4'
}

export function createLanguageModel(
  provider: LlmProviderId,
  purpose: LlmPurpose,
  orgKeys?: OrgLlmApiKeys | null,
): LanguageModel {
  const modelId = getModelId(provider, purpose, orgKeys)
  const apiKey = resolveKeyForProvider(provider, orgKeys)

  switch (provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey })
      return anthropic(modelId)
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey })
      return openai(modelId)
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey })
      return google(modelId)
    }
    case 'groq': {
      const groq = createGroq({ apiKey })
      return groq(modelId)
    }
    case 'glm': {
      const glm = createOpenAI({
        apiKey,
        baseURL: getGlmBaseUrl(orgKeys),
      })
      return glm(modelId)
    }
  }
}

export function providerLabel(provider: LlmProviderId): string {
  switch (provider) {
    case 'anthropic':
      return 'Claude'
    case 'openai':
      return 'OpenAI'
    case 'google':
      return 'Gemini'
    case 'groq':
      return 'Groq'
    case 'glm':
      return 'GLM (Z.AI)'
  }
}

export const BILLING_URLS: Record<LlmProviderId, string> = {
  anthropic: 'https://console.anthropic.com/settings/billing',
  openai: 'https://platform.openai.com/settings/organization/billing',
  google: 'https://aistudio.google.com/apikey',
  groq: 'https://console.groq.com/settings/billing',
  glm: 'https://z.ai/',
}
