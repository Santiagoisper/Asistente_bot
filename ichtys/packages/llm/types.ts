export type LlmProviderId = 'anthropic' | 'openai' | 'google' | 'groq' | 'glm'

/**
 * `auto` = cadena de proveedores con respaldo: se salta los que no tienen clave y, si uno falla
 * por saldo/cuota/clave inválida/tiempo, prueba el siguiente. Una preferencia concreta usa solo
 * ese proveedor. Embeddings van aparte (ver packages/ingestion/embedding-config.ts).
 */
export type LlmProviderPreference = LlmProviderId | 'auto'

export type LlmPurpose = 'answer' | 'spec' | 'title' | 'clinical-extract'

/**
 * Orden por defecto del modo automático. Claude (Haiku para chat/títulos, Sonnet para extraer el
 * protocolo) va primero; Gemini y Groq son respaldo barato; GLM va último porque depende de saldo
 * de API prepago en Z.ai. Se puede cambiar SIN redeploy con la variable LLM_PROVIDER_CHAIN
 * (lista separada por comas, p. ej. "groq,google,anthropic").
 */
export const AUTO_PROVIDER_CHAIN: readonly LlmProviderId[] = ['anthropic', 'google', 'groq', 'glm']

export const KNOWN_PROVIDERS: readonly LlmProviderId[] = ['anthropic', 'openai', 'google', 'groq', 'glm']
