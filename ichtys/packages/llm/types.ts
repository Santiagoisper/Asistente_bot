export type LlmProviderId = 'anthropic' | 'openai' | 'google' | 'groq' | 'glm'

/**
 * `auto` = GLM → Claude → OpenAI → Gemini → Groq.
 * Salta proveedores sin API key; si uno falla por cuota/key inválida, prueba el siguiente.
 * Embeddings siguen en OpenAI independientemente.
 */
export type LlmProviderPreference = LlmProviderId | 'auto'

export type LlmPurpose = 'answer' | 'spec' | 'title' | 'clinical-extract'

/** Orden en modo automático: GLM primero, luego proveedores de respaldo. */
export const AUTO_PROVIDER_CHAIN: readonly LlmProviderId[] = [
  'glm',
  'anthropic',
  'openai',
  'google',
  'groq',
]
