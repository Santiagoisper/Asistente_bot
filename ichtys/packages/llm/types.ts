export type LlmProviderId = 'anthropic' | 'openai' | 'google' | 'groq' | 'glm'

/**
 * `auto` = Claude → OpenAI → Gemini → Groq → GLM.
 * Salta proveedores sin API key; si uno falla por cuota/key inválida, prueba el siguiente.
 * Embeddings siguen en OpenAI independientemente.
 */
export type LlmProviderPreference = LlmProviderId | 'auto'

export type LlmPurpose = 'answer' | 'spec' | 'title' | 'clinical-extract'

/**
 * Orden en modo automático: titulares primero, backups después.
 * GLM salió del producto (decisión de Santiago, E2E 2026-10-22): la cuenta
 * Z.ai es solo para programación. 'glm' sigue en LlmProviderId solo para
 * reconocer preferencias legadas guardadas (se migran a 'anthropic' al leer).
 */
export const AUTO_PROVIDER_CHAIN: readonly LlmProviderId[] = [
  'anthropic',
  'openai',
  'google',
  'groq',
]
