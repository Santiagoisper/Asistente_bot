export type LlmProviderId = 'anthropic' | 'openai' | 'google' | 'groq' | 'glm'

/**
 * Las preferencias anteriores se aceptan por compatibilidad, pero la app usa GLM para generación.
 * Embeddings siguen en OpenAI independientemente.
 */
export type LlmProviderPreference = LlmProviderId | 'auto'

export type LlmPurpose = 'answer' | 'spec' | 'title' | 'clinical-extract'

/** Proveedor generativo único de ALPHI. */
export const AUTO_PROVIDER_CHAIN: readonly LlmProviderId[] = ['glm']
