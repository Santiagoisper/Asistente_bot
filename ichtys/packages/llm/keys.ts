import type { LlmProviderId } from './types'

export type OrgLlmKeyProvider = 'anthropic' | 'openai' | 'google' | 'groq' | 'openrouter'

export type OrgLlmApiKeys = Partial<Record<OrgLlmKeyProvider, string>>

const PROVIDER_TO_KEY: Record<LlmProviderId, OrgLlmKeyProvider> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  groq: 'groq',
  glm: 'openrouter',
}

export function resolveKeyForProvider(
  provider: LlmProviderId,
  orgKeys?: OrgLlmApiKeys | null,
): string | undefined {
  const keyName = PROVIDER_TO_KEY[provider]
  const orgKey = orgKeys?.[keyName]?.trim()
  if (orgKey) return orgKey

  switch (provider) {
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY?.trim() || undefined
    case 'openai':
      return process.env.OPENAI_API_KEY?.trim() || undefined
    case 'google':
      return (
        process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
        process.env.GOOGLE_API_KEY?.trim() ||
        undefined
      )
    case 'groq':
      return process.env.GROQ_API_KEY?.trim() || undefined
    case 'glm':
      return process.env.OPENROUTER_API_KEY?.trim() || undefined
  }
}

export function getKeySourceForProvider(
  provider: LlmProviderId,
  orgKeys?: OrgLlmApiKeys | null,
): 'org' | 'platform' | 'none' {
  const keyName = PROVIDER_TO_KEY[provider]
  if (orgKeys?.[keyName]?.trim()) return 'org'
  if (resolveKeyForProvider(provider, null)) return 'platform'
  return 'none'
}
