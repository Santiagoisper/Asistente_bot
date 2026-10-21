import { describe, expect, it, vi } from 'vitest'

vi.mock('@ichtys/db', () => ({
  microsToUsd: (micros: number) => micros / 1_000_000,
}))

import { buildUsageView, quotaMessage, USAGE_KIND_LABELS } from '../usage-view'
import { formatUsd } from '../usage-format'

const period = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z') }

function quota(overrides: Record<string, unknown> = {}) {
  return {
    planName: 'Profesional',
    budgetMicros: 100_000_000,
    usedMicros: 25_000_000,
    remainingMicros: 75_000_000,
    percentUsed: 25,
    state: 'ok' as const,
    period,
    ...overrides,
  }
}

function summary(rows: Array<Record<string, unknown>> = []) {
  return {
    period,
    rows: rows as never,
    platformTokens: 0,
    orgKeyTokens: 0,
    totalTokens: 0,
    platformCostMicros: 0,
    orgKeyCostMicros: 0,
    totalCostMicros: 0,
  }
}

describe('buildUsageView', () => {
  it('convierte micro-USD a USD y arma el período en español', () => {
    const view = buildUsageView(quota(), summary())
    expect(view.periodLabel).toBe('octubre de 2026')
    expect(view.quota).toMatchObject({
      planName: 'Profesional',
      budgetUsd: 100,
      usedUsd: 25,
      remainingUsd: 75,
      percentUsed: 25,
      state: 'ok',
    })
  })

  it('une plataforma y clave propia de una misma operación y ordena por costo', () => {
    const view = buildUsageView(
      quota(),
      {
        ...summary([
          { kind: 'embedding_document', keySource: 'platform', inputTokens: 5000, outputTokens: 0, costMicros: 750_000, calls: 9 },
          { kind: 'chat_answer', keySource: 'platform', inputTokens: 1000, outputTokens: 200, costMicros: 3_000_000, calls: 4 },
          { kind: 'chat_answer', keySource: 'org', inputTokens: 300, outputTokens: 100, costMicros: 900_000, calls: 2 },
        ]),
        platformTokens: 6200,
        orgKeyTokens: 400,
        totalTokens: 6600,
        platformCostMicros: 3_750_000,
        orgKeyCostMicros: 900_000,
        totalCostMicros: 4_650_000,
      },
    )

    expect(view.rows.map((row) => row.kind)).toEqual(['chat_answer', 'embedding_document'])
    expect(view.rows[0]).toMatchObject({
      label: USAGE_KIND_LABELS.chat_answer,
      platformUsd: 3,
      orgKeyUsd: 0.9,
      tokens: 1600,
      calls: 6,
    })
    expect(view.totals).toEqual({ platformUsd: 3.75, orgKeyUsd: 0.9, totalUsd: 4.65, totalTokens: 6600 })
  })

  it('sin cupo definido no inventa presupuesto', () => {
    const view = buildUsageView(
      quota({ planName: null, budgetMicros: null, remainingMicros: null, percentUsed: null, state: 'no_quota' }),
      summary(),
    )
    expect(view.quota).toMatchObject({ budgetUsd: null, remainingUsd: null, percentUsed: null, state: 'no_quota' })
  })

  it('no expone nada más que importes, tokens y conteos (sin contenido)', () => {
    const view = buildUsageView(quota(), summary([
      { kind: 'chat_title', keySource: 'platform', inputTokens: 10, outputTokens: 5, costMicros: 1000, calls: 1 },
    ]))
    expect(Object.keys(view.rows[0] ?? {}).sort()).toEqual(
      ['calls', 'kind', 'label', 'orgKeyUsd', 'platformUsd', 'tokens'].sort(),
    )
  })

  it('cada tipo de operación tiene una etiqueta en español', () => {
    for (const label of Object.values(USAGE_KIND_LABELS)) expect(label.length).toBeGreaterThan(3)
  })
})

describe('quotaMessage', () => {
  it('ok / sin cupo no alarman', () => {
    expect(quotaMessage('ok', 10)).toMatch(/dentro de tu cupo/i)
    expect(quotaMessage('no_quota', null)).toMatch(/no hay límite/i)
  })

  it('advertencia menciona el porcentaje y la clave propia', () => {
    const message = quotaMessage('warning', 85)
    expect(message).toContain('85 %')
    expect(message).toMatch(/clave de IA/i)
  })

  it('cupo agotado ofrece salidas claras', () => {
    expect(quotaMessage('exceeded', 100)).toMatch(/clave de IA.*ampliá tu plan/i)
  })
})

describe('formatUsd', () => {
  it('formatea con dos decimales y prefijo US$', () => {
    expect(formatUsd(0)).toBe('US$ 0,00')
    expect(formatUsd(100)).toBe('US$ 100,00')
    expect(formatUsd(1234.5)).toBe('US$ 1.234,50')
  })
})
