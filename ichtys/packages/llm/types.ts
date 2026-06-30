export type LlmProviderId = 'anthropic' | 'google'

/** `auto` = Claude primero; si cuota agotada, Gemini (si hay API key). */
export type LlmProviderPreference = LlmProviderId | 'auto'

export type LlmPurpose = 'answer' | 'spec' | 'title'
