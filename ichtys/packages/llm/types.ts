export type LlmProviderId = 'anthropic' | 'openai' | 'google' | 'groq' | 'glm'

/**
 * `auto` = Claude → OpenAI → Gemini → Groq → GLM.
 * Salta proveedores sin API key; si uno falla por cuota/key inválida, prueba el siguiente.
 * Embeddings siguen en OpenAI independientemente.
 */
export type LlmProviderPreference = LlmProviderId | 'auto'

export type LlmPurpose = 'answer' | 'spec' | 'title'

/** Orden en modo automático: titulares primero, backups después. */
export const AUTO_PROVIDER_CHAIN: readonly LlmProviderId[] = [
  'anthropic',
  'openai',
  'google',
  'groq',
  'glm',
]
