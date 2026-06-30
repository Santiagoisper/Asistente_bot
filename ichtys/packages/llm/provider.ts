import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import type { LlmProviderId, LlmProviderPreference, LlmPurpose } from './types'

export function getDefaultProviderPreference(): LlmProviderPreference {
  const env = process.env.LLM_PROVIDER?.toLowerCase().trim()
  if (env === 'google' || env === 'gemini') return 'google'
  if (env === 'anthropic' || env === 'claude') return 'anthropic'
  return 'auto'
}

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim())
}

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
}

export function getModelId(provider: LlmProviderId, purpose: LlmPurpose): string {
  if (provider === 'google') {
    if (purpose === 'title') {
      return process.env.GOOGLE_TITLE_MODEL ?? 'gemini-2.0-flash'
    }
    if (purpose === 'spec') {
      return (
        process.env.SPEC_EXTRACTION_MODEL_GOOGLE ??
        process.env.GOOGLE_ANSWER_MODEL ??
        'gemini-2.0-flash'
      )
    }
    return process.env.ANSWER_MODEL_GOOGLE ?? process.env.GOOGLE_ANSWER_MODEL ?? 'gemini-2.0-flash'
  }

  if (purpose === 'title') {
    return process.env.TITLE_MODEL ?? 'claude-haiku-4-5'
  }
  if (purpose === 'spec') {
    return process.env.SPEC_EXTRACTION_MODEL ?? 'claude-sonnet-4-6'
  }
  return process.env.ANSWER_MODEL ?? 'claude-sonnet-4-6'
}

export function createLanguageModel(provider: LlmProviderId, purpose: LlmPurpose): LanguageModel {
  const modelId = getModelId(provider, purpose)
  if (provider === 'google') {
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    })
    return google(modelId)
  }
  const anthropic = createAnthropic()
  return anthropic(modelId)
}

export function providerLabel(provider: LlmProviderId): string {
  return provider === 'google' ? 'Gemini' : 'Claude'
}
