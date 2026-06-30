import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { resolveKeyForProvider } from './keys'
import type { OrgLlmApiKeys } from './keys'
import { AUTO_PROVIDER_CHAIN, type LlmProviderId, type LlmProviderPreference, type LlmPurpose } from './types'

export type { OrgLlmApiKeys }

export function getDefaultProviderPreference(): LlmProviderPreference {
  const env = process.env.LLM_PROVIDER?.toLowerCase().trim()
  if (env === 'anthropic' || env === 'claude') return 'anthropic'
  if (env === 'openai' || env === 'gpt') return 'openai'
  if (env === 'google' || env === 'gemini') return 'google'
  if (env === 'groq') return 'groq'
  if (env === 'glm' || env === 'openrouter') return 'glm'
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

export function resolveProviderChain(preference?: LlmProviderPreference): LlmProviderId[] {
  const resolved = preference ?? getDefaultProviderPreference()
  if (resolved === 'auto') return [...AUTO_PROVIDER_CHAIN]
  return [resolved]
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

export function getModelId(provider: LlmProviderId, purpose: LlmPurpose): string {
  switch (provider) {
    case 'anthropic':
      if (purpose === 'title') return process.env.TITLE_MODEL ?? 'claude-haiku-4-5'
      if (purpose === 'spec') return process.env.SPEC_EXTRACTION_MODEL ?? 'claude-sonnet-4-5'
      return process.env.ANSWER_MODEL ?? 'claude-sonnet-4-5'
    case 'openai':
      if (purpose === 'title') return process.env.OPENAI_TITLE_MODEL ?? 'gpt-4o-mini'
      if (purpose === 'spec') {
        return process.env.SPEC_EXTRACTION_MODEL_OPENAI ?? process.env.OPENAI_ANSWER_MODEL ?? 'gpt-4o'
      }
      return process.env.OPENAI_ANSWER_MODEL ?? process.env.ANSWER_MODEL_OPENAI ?? 'gpt-4o'
    case 'google':
      if (purpose === 'title') {
        return process.env.GOOGLE_TITLE_MODEL ?? process.env.GEMINI_TITLE_MODEL ?? 'gemini-2.0-flash'
      }
      if (purpose === 'spec') {
        return (
          process.env.SPEC_EXTRACTION_MODEL_GEMINI ??
          process.env.GEMINI_ANSWER_MODEL ??
          'gemini-2.0-flash'
        )
      }
      return process.env.GEMINI_ANSWER_MODEL ?? process.env.GOOGLE_ANSWER_MODEL ?? 'gemini-2.0-flash'
    case 'groq':
      if (purpose === 'title') return process.env.GROQ_TITLE_MODEL ?? 'llama-3.1-8b-instant'
      if (purpose === 'spec') {
        return process.env.SPEC_EXTRACTION_MODEL_GROQ ?? process.env.GROQ_ANSWER_MODEL ?? 'llama-3.3-70b-versatile'
      }
      return process.env.GROQ_ANSWER_MODEL ?? 'llama-3.3-70b-versatile'
    case 'glm':
      if (purpose === 'title') return process.env.GLM_TITLE_MODEL ?? process.env.GLM_MODEL ?? 'z-ai/glm-5.2'
      if (purpose === 'spec') {
        return process.env.SPEC_EXTRACTION_MODEL_GLM ?? process.env.GLM_MODEL ?? 'z-ai/glm-5.2'
      }
      return process.env.GLM_ANSWER_MODEL ?? process.env.GLM_MODEL ?? 'z-ai/glm-5.2'
  }
}

export function createLanguageModel(
  provider: LlmProviderId,
  purpose: LlmPurpose,
  orgKeys?: OrgLlmApiKeys | null,
): LanguageModel {
  const modelId = getModelId(provider, purpose)
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
      const openrouter = createOpenAI({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
      })
      return openrouter(modelId)
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
      return 'GLM (OpenRouter)'
  }
}

export const BILLING_URLS: Record<LlmProviderId, string> = {
  anthropic: 'https://console.anthropic.com/settings/billing',
  openai: 'https://platform.openai.com/settings/organization/billing',
  google: 'https://aistudio.google.com/apikey',
  groq: 'https://console.groq.com/settings/billing',
  glm: 'https://openrouter.ai/settings/credits',
}
