/**
 * usage-pricing.ts — costo ESTIMADO de cada llamada a un modelo, en micro-dólares (1e-6 USD).
 *
 * Es una estimación para dimensionar el cupo del plan, NO una factura del proveedor:
 *  - Los precios cambian; revisarlos periódicamente contra las páginas oficiales.
 *  - Se guarda el costo calculado al momento del evento, así un cambio de precios posterior
 *    no reescribe el historial.
 *  - Un modelo desconocido se cobra a una tarifa conservadora ALTA (mejor sobre-estimar que
 *    subestimar el gasto); se puede corregir con USAGE_PRICE_OVERRIDES_JSON sin redeploy de código.
 *
 * Unidad: USD por millón de tokens. Como 1 USD = 1e6 micro-USD y los tokens se miden en
 * millones, costoMicros = tokens × precioPorMillón (sin factores adicionales).
 */

export interface ModelPrice {
  /** USD por 1M de tokens de entrada. */
  inputPerMTok: number
  /** USD por 1M de tokens de salida (0 en embeddings). */
  outputPerMTok: number
}

interface PriceRule extends ModelPrice {
  /** Coincidencia por prefijo del identificador del modelo (minúsculas). */
  modelPrefix: string
}

/** Tarifa para modelos no listados: deliberadamente alta. */
export const FALLBACK_PRICE: ModelPrice = { inputPerMTok: 3, outputPerMTok: 15 }

/**
 * Orden importa: la primera regla cuyo prefijo coincide gana, así que los prefijos más
 * específicos van antes (p. ej. 'gpt-4o-mini' antes de 'gpt-4o').
 * Fuentes: páginas de precios de cada proveedor; Anthropic verificado con la skill
 * claude-api al 2026-10-22; GLM-5.2 en fuentes secundarias con valores contradictorios
 * (0.98/3.08 vs 1.40/4.40): se usa el mayor.
 */
const PRICE_RULES: readonly PriceRule[] = [
  // Z.ai / GLM (también aparece como 'z-ai/glm-…' vía OpenRouter)
  { modelPrefix: 'z-ai/glm-5', inputPerMTok: 1.4, outputPerMTok: 4.4 },
  { modelPrefix: 'glm-5', inputPerMTok: 1.4, outputPerMTok: 4.4 },
  { modelPrefix: 'glm-4', inputPerMTok: 0.6, outputPerMTok: 2.2 },
  // Google
  { modelPrefix: 'gemini-embedding', inputPerMTok: 0.15, outputPerMTok: 0 },
  { modelPrefix: 'gemini-2.0-flash', inputPerMTok: 0.1, outputPerMTok: 0.4 },
  // OpenAI
  { modelPrefix: 'text-embedding-3-small', inputPerMTok: 0.02, outputPerMTok: 0 },
  { modelPrefix: 'gpt-4o-mini', inputPerMTok: 0.15, outputPerMTok: 0.6 },
  { modelPrefix: 'gpt-4o', inputPerMTok: 2.5, outputPerMTok: 10 },
  // Anthropic — vigentes 2026-10-22 (skill claude-api; USD por MTok).
  // Cache reads se tarifican a precio pleno de input (sobre-estima ≈10x su
  // costo real: seguro para dimensionar el cupo). Prefijos específicos antes
  // que los genéricos.
  { modelPrefix: 'claude-opus-5-5', inputPerMTok: 4, outputPerMTok: 20 },
  { modelPrefix: 'claude-sonnet-5-5', inputPerMTok: 2, outputPerMTok: 10 },
  { modelPrefix: 'claude-haiku-5-5', inputPerMTok: 0.1, outputPerMTok: 0.5 },
  // Históricos 4.x (eventos ya registrados con esos ids).
  { modelPrefix: 'claude-sonnet-4-6', inputPerMTok: 3, outputPerMTok: 15 },
  { modelPrefix: 'claude-sonnet-4-5', inputPerMTok: 3, outputPerMTok: 15 },
  { modelPrefix: 'claude-haiku-4-5', inputPerMTok: 1, outputPerMTok: 5 },
  // Genéricos conservadores para ids no listados de esa familia.
  { modelPrefix: 'claude-haiku', inputPerMTok: 1, outputPerMTok: 5 },
  { modelPrefix: 'claude-sonnet', inputPerMTok: 3, outputPerMTok: 15 },
  // Groq
  { modelPrefix: 'llama-3.1-8b', inputPerMTok: 0.05, outputPerMTok: 0.08 },
  { modelPrefix: 'llama-3.3-70b', inputPerMTok: 0.59, outputPerMTok: 0.79 },
]

function isValidPrice(value: unknown): value is ModelPrice {
  if (typeof value !== 'object' || value === null) return false
  const price = value as Record<string, unknown>
  return (
    typeof price.inputPerMTok === 'number' &&
    typeof price.outputPerMTok === 'number' &&
    Number.isFinite(price.inputPerMTok) &&
    Number.isFinite(price.outputPerMTok) &&
    price.inputPerMTok >= 0 &&
    price.outputPerMTok >= 0
  )
}

/**
 * Overrides opcionales: JSON {"<prefijo-de-modelo>": {"inputPerMTok": n, "outputPerMTok": n}}.
 * Un JSON inválido se ignora (no rompe el cálculo; se usan las tarifas por defecto).
 */
function readOverrides(): PriceRule[] {
  const raw = process.env.USAGE_PRICE_OVERRIDES_JSON?.trim()
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return []
    return Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, ModelPrice] => isValidPrice(entry[1]))
      .map(([modelPrefix, price]) => ({ modelPrefix: modelPrefix.toLowerCase(), ...price }))
  } catch {
    return []
  }
}

export function resolveModelPrice(model: string): { price: ModelPrice; known: boolean } {
  const id = model.trim().toLowerCase()
  const rule = [...readOverrides(), ...PRICE_RULES].find((candidate) => id.startsWith(candidate.modelPrefix))
  if (rule) {
    return { price: { inputPerMTok: rule.inputPerMTok, outputPerMTok: rule.outputPerMTok }, known: true }
  }
  return { price: FALLBACK_PRICE, known: false }
}

function sanitize(tokens: number): number {
  return Number.isFinite(tokens) && tokens > 0 ? tokens : 0
}

/** Costo estimado en micro-USD (entero). */
export function estimateCostMicros(model: string, inputTokens: number, outputTokens: number): number {
  const { price } = resolveModelPrice(model)
  return Math.round(sanitize(inputTokens) * price.inputPerMTok + sanitize(outputTokens) * price.outputPerMTok)
}

const MICROS_PER_USD = 1_000_000

export function usdToMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD)
}

export function microsToUsd(micros: number): number {
  return micros / MICROS_PER_USD
}
