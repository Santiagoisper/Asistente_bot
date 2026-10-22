/**
 * Opciones de proveedor LLM de Ajustes y su disponibilidad.
 *
 * Extraído del form para poder testear: las descripciones deben reflejar el
 * mapa real de getModelId (@ichtys/llm/provider.ts) — hoy Claude 4.x mientras
 * dure ai@4 (los claude-*-5-5 rechazan temperature/tool_choice que el SDK
 * envía siempre; ver commit e6539fc). Un proveedor sin clave (ni de la org ni
 * de la plataforma) no es seleccionable: elegirlo dejó el chat de una org en
 * respuestas vacías silenciosas (E2E 2026-10-22).
 */

// 'glm' sigue en el union solo porque rag_config legado lo trae de la DB
// (se migra a 'anthropic' al leer, ver @ichtys/db org-config); ya no es
// opción seleccionable en la UI.
export type LlmProvider = 'auto' | 'anthropic' | 'openai' | 'google' | 'groq' | 'glm'

export type LlmKeyProvider = 'anthropic' | 'openai' | 'google' | 'groq' | 'openrouter'

export type LlmKeyStatusLike = {
  provider: LlmKeyProvider
  configured: boolean
}

export const PROVIDER_OPTIONS: { value: LlmProvider; label: string; description: string }[] = [
  {
    value: 'auto',
    label: 'Automático (recomendado)',
    description:
      'Claude → OpenAI → Gemini → Groq. Si uno falla, prueba el siguiente.',
  },
  {
    value: 'anthropic',
    label: 'Claude (Anthropic)',
    description: 'Claude por propósito: Sonnet 4.6 en chat y clínica, Haiku 4.5 en títulos, Opus 4.6 en specs.',
  },
  { value: 'openai', label: 'OpenAI (GPT)', description: 'GPT-4o en chat y specs; GPT-4o mini en títulos.' },
  { value: 'google', label: 'Gemini (Google)', description: 'Gemini 2.0 Flash para chat y specs.' },
  { value: 'groq', label: 'Groq (gratis)', description: 'Llama 3.3 70B en chat; Llama 3.1 8B en títulos.' },
]

/** Qué campo de clave habilita a cada proveedor (glm usa la clave de OpenRouter). */
export const PROVIDER_KEY_FIELD: Record<Exclude<LlmProvider, 'auto' | 'glm'>, LlmKeyProvider> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  groq: 'groq',
}

/** ¿El proveedor tiene una clave disponible (org o plataforma)? */
export function isProviderSelectable(
  provider: LlmProvider,
  llmKeys: readonly LlmKeyStatusLike[],
): boolean {
  if (provider === 'auto') return true
  // 'glm' legado (guardado antes de salir del producto): no seleccionable.
  if (provider === 'glm') return false
  const field = PROVIDER_KEY_FIELD[provider as Exclude<LlmProvider, 'auto' | 'glm'>]
  return llmKeys.find((k) => k.provider === field)?.configured ?? false
}

/** Nota que se muestra junto a una opción sin clave disponible. */
export function providerUnavailableHint(): string {
  return 'Sin clave disponible: cargá la clave abajo para habilitar este proveedor.'
}
