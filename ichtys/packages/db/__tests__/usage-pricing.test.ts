import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FALLBACK_PRICE,
  estimateCostMicros,
  microsToUsd,
  resolveModelPrice,
  usdToMicros,
} from '../usage-pricing'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('estimateCostMicros', () => {
  it('costoMicros = tokens × precio por millón (sin factores extra)', () => {
    // Gemini Embedding: 0.15 USD / 1M de entrada.
    expect(estimateCostMicros('gemini-embedding-001', 1_000_000, 0)).toBe(usdToMicros(0.15))
    // GLM-5.2: 1.40 entrada / 4.40 salida => 1M + 1M = 5.80 USD.
    expect(estimateCostMicros('glm-5.2', 1_000_000, 1_000_000)).toBe(usdToMicros(5.8))
  })

  it('cuenta aparte entrada y salida', () => {
    expect(estimateCostMicros('claude-sonnet-4-5', 1_000_000, 0)).toBe(usdToMicros(3))
    expect(estimateCostMicros('claude-sonnet-4-5', 0, 1_000_000)).toBe(usdToMicros(15))
  })

  it('reconoce el prefijo de OpenRouter para GLM', () => {
    expect(resolveModelPrice('z-ai/glm-5.2')).toMatchObject({
      known: true,
      price: { inputPerMTok: 1.4, outputPerMTok: 4.4 },
    })
  })

  it('el prefijo más específico gana (gpt-4o-mini antes que gpt-4o)', () => {
    expect(resolveModelPrice('gpt-4o-mini').price.inputPerMTok).toBe(0.15)
    expect(resolveModelPrice('gpt-4o-2024-08-06').price.inputPerMTok).toBe(2.5)
  })

  it('ignora mayúsculas y espacios', () => {
    expect(resolveModelPrice('  GLM-5.2 ').known).toBe(true)
  })

  it('un modelo desconocido usa la tarifa conservadora ALTA, nunca una barata', () => {
    const resolved = resolveModelPrice('modelo-que-no-existe')
    expect(resolved.known).toBe(false)
    expect(resolved.price).toEqual(FALLBACK_PRICE)
    expect(estimateCostMicros('modelo-que-no-existe', 1_000_000, 1_000_000)).toBe(usdToMicros(18))
  })

  it('tokens inválidos cuentan como cero', () => {
    expect(estimateCostMicros('glm-5.2', Number.NaN, -5)).toBe(0)
    expect(estimateCostMicros('glm-5.2', Number.POSITIVE_INFINITY, 0)).toBe(0)
  })
})

describe('USAGE_PRICE_OVERRIDES_JSON', () => {
  it('permite corregir un precio sin tocar el código', () => {
    vi.stubEnv('USAGE_PRICE_OVERRIDES_JSON', JSON.stringify({ 'glm-5': { inputPerMTok: 0.98, outputPerMTok: 3.08 } }))
    expect(resolveModelPrice('glm-5.2').price).toEqual({ inputPerMTok: 0.98, outputPerMTok: 3.08 })
  })

  it('un override tiene prioridad sobre la tabla por defecto', () => {
    vi.stubEnv('USAGE_PRICE_OVERRIDES_JSON', JSON.stringify({ 'glm-5.2': { inputPerMTok: 9, outputPerMTok: 9 } }))
    expect(estimateCostMicros('glm-5.2', 1_000_000, 0)).toBe(usdToMicros(9))
  })

  it('un JSON inválido se ignora y se usan las tarifas por defecto', () => {
    vi.stubEnv('USAGE_PRICE_OVERRIDES_JSON', '{no es json')
    expect(resolveModelPrice('glm-5.2').price.inputPerMTok).toBe(1.4)
  })

  it('precios inválidos (negativos, no numéricos) se descartan', () => {
    vi.stubEnv(
      'USAGE_PRICE_OVERRIDES_JSON',
      JSON.stringify({
        'glm-5': { inputPerMTok: -1, outputPerMTok: 1 },
        'gpt-4o': { inputPerMTok: 'gratis', outputPerMTok: 1 },
      }),
    )
    expect(resolveModelPrice('glm-5.2').price.inputPerMTok).toBe(1.4)
    expect(resolveModelPrice('gpt-4o').price.inputPerMTok).toBe(2.5)
  })
})

describe('conversión USD <-> micro-USD', () => {
  it('ida y vuelta', () => {
    expect(usdToMicros(100)).toBe(100_000_000)
    expect(microsToUsd(100_000_000)).toBe(100)
    expect(microsToUsd(usdToMicros(0.15))).toBeCloseTo(0.15, 6)
  })
})
