process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test?sslmode=disable'

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface RecordedCall {
  method: string
  args: unknown[]
}

const fake = vi.hoisted(() => ({
  results: [] as unknown[],
  calls: [] as RecordedCall[],
  insertImpl: null as null | ((values: unknown) => Promise<void>),
}))

vi.mock('../client', () => {
  // Builder encadenable: cada método devuelve el mismo objeto; al hacer await resuelve con el
  // próximo resultado encolado. Registra las llamadas para inspeccionar los where.
  function makeBuilder(): Record<string, unknown> {
    const builder: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'groupBy', 'limit', 'set']) {
      builder[method] = (...args: unknown[]) => {
        fake.calls.push({ method, args })
        return builder
      }
    }
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(fake.results.shift()).then(resolve, reject)
    return builder
  }

  return {
    db: {
      select: () => makeBuilder(),
      update: () => makeBuilder(),
      insert: () => ({
        values: async (values: unknown) => {
          fake.calls.push({ method: 'insert.values', args: [values] })
          if (fake.insertImpl) await fake.insertImpl(values)
        },
      }),
    },
  }
})

import {
  QUOTA_WARNING_RATIO,
  canUsePlatformKey,
  evaluateQuota,
  getQuotaStatus,
  getUsagePeriod,
  getUsageSummary,
  recordUsage,
  setOrgPlan,
} from '../usage'
import { usdToMicros } from '../usage-pricing'

const dialect = new PgDialect()
const orgId = '11111111-1111-4111-8111-111111111111'
const HUNDRED_USD = usdToMicros(100)

function lastWhereQuery(): { sql: string; params: unknown[] } {
  const where = [...fake.calls].reverse().find((call) => call.method === 'where')
  if (!where) throw new Error('no where recorded')
  return dialect.sqlToQuery(where.args[0] as Parameters<PgDialect['sqlToQuery']>[0])
}

beforeEach(() => {
  fake.results.length = 0
  fake.calls.length = 0
  fake.insertImpl = null
  vi.restoreAllMocks()
})

describe('getUsagePeriod', () => {
  it('devuelve el mes calendario UTC', () => {
    const { start, end } = getUsagePeriod(new Date('2026-10-21T15:30:00Z'))
    expect(start.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })

  it('cruza el fin de año', () => {
    const { start, end } = getUsagePeriod(new Date('2026-12-31T23:59:59Z'))
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('el primer instante del mes ya pertenece al mes nuevo', () => {
    const { start } = getUsagePeriod(new Date('2026-11-01T00:00:00Z'))
    expect(start.toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })
})

describe('evaluateQuota (cupo de 100 USD)', () => {
  it('sin cupo definido no limita', () => {
    expect(evaluateQuota(null, 5_000_000_000)).toMatchObject({ state: 'no_quota', budgetMicros: null })
    expect(evaluateQuota(0, 10)).toMatchObject({ state: 'no_quota' })
  })

  it('ok por debajo del umbral de aviso', () => {
    expect(evaluateQuota(HUNDRED_USD, usdToMicros(79.99))).toMatchObject({ state: 'ok', percentUsed: 80 })
  })

  it('advierte desde el 80 %', () => {
    expect(QUOTA_WARNING_RATIO).toBe(0.8)
    expect(evaluateQuota(HUNDRED_USD, usdToMicros(80))).toMatchObject({ state: 'warning' })
    expect(evaluateQuota(HUNDRED_USD, usdToMicros(99.99))).toMatchObject({ state: 'warning' })
  })

  it('agotado al llegar al cupo y nunca devuelve restante negativo ni porcentaje > 100', () => {
    expect(evaluateQuota(HUNDRED_USD, HUNDRED_USD)).toMatchObject({
      state: 'exceeded',
      remainingMicros: 0,
      percentUsed: 100,
    })
    expect(evaluateQuota(HUNDRED_USD, usdToMicros(250))).toMatchObject({
      state: 'exceeded',
      remainingMicros: 0,
      percentUsed: 100,
    })
  })

  it('calcula el restante', () => {
    expect(evaluateQuota(HUNDRED_USD, usdToMicros(30))).toMatchObject({
      remainingMicros: usdToMicros(70),
      percentUsed: 30,
    })
  })

  it('un consumo negativo se trata como cero', () => {
    expect(evaluateQuota(HUNDRED_USD, -50)).toMatchObject({ state: 'ok', usedMicros: 0 })
  })
})

describe('canUsePlatformKey', () => {
  it('solo bloquea cuando el cupo está agotado', () => {
    expect(canUsePlatformKey({ state: 'no_quota' })).toBe(true)
    expect(canUsePlatformKey({ state: 'ok' })).toBe(true)
    expect(canUsePlatformKey({ state: 'warning' })).toBe(true)
    expect(canUsePlatformKey({ state: 'exceeded' })).toBe(false)
  })
})

describe('recordUsage', () => {
  const base = {
    orgId,
    kind: 'chat_answer' as const,
    provider: 'glm',
    model: 'glm-5.2',
    keySource: 'platform' as const,
  }

  it('inserta conteos, costo estimado y metadatos, nunca contenido', async () => {
    // glm-5.x: 1.40 USD/M entrada y 4.40 USD/M salida => 1M entrada + 1M salida = 5.80 USD
    await recordUsage({ ...base, studyId: 's1', userId: 'u1', inputTokens: 1_000_000, outputTokens: 1_000_000 })

    const insert = fake.calls.find((call) => call.method === 'insert.values')
    expect(insert?.args[0]).toEqual({
      organizationId: orgId,
      studyId: 's1',
      userId: 'u1',
      kind: 'chat_answer',
      provider: 'glm',
      model: 'glm-5.2',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      costMicros: usdToMicros(5.8),
      keySource: 'platform',
    })
  })

  it('normaliza tokens inválidos: negativos, NaN, decimales y valores absurdos', async () => {
    await recordUsage({ ...base, inputTokens: 10.9, outputTokens: Number.NaN })
    await recordUsage({ ...base, inputTokens: Number.POSITIVE_INFINITY, outputTokens: 7 })
    await recordUsage({ ...base, inputTokens: 9_999_999_999_999, outputTokens: -4 })

    const values = fake.calls
      .filter((call) => call.method === 'insert.values')
      .map((call) => call.args[0] as { inputTokens: number; outputTokens: number })
    expect(values).toEqual([
      expect.objectContaining({ inputTokens: 10, outputTokens: 0 }),
      expect.objectContaining({ inputTokens: 0, outputTokens: 7 }),
      expect.objectContaining({ inputTokens: 2_000_000_000, outputTokens: 0 }),
    ])
  })

  it('no registra eventos sin tokens', async () => {
    await recordUsage({ ...base, inputTokens: 0, outputTokens: 0 })
    expect(fake.calls.filter((call) => call.method === 'insert.values')).toHaveLength(0)
  })

  it('nunca lanza si la base falla y no filtra el detalle del error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fake.insertImpl = async () => {
      throw new Error('connection string postgresql://user:secreto@host/db')
    }

    await expect(recordUsage({ ...base, inputTokens: 5, outputTokens: 5 })).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secreto')
  })
})

describe('getUsageSummary', () => {
  it('agrega por tipo y origen de clave, filtrando siempre por organización y período', async () => {
    fake.results.push([
      { kind: 'chat_answer', keySource: 'platform', inputTokens: '1000', outputTokens: '200', costMicros: '3000', calls: '4' },
      { kind: 'embedding_document', keySource: 'platform', inputTokens: '5000', outputTokens: '0', costMicros: '750', calls: '9' },
      { kind: 'chat_answer', keySource: 'org', inputTokens: '300', outputTokens: '100', costMicros: '900', calls: '2' },
    ])

    const summary = await getUsageSummary(orgId, getUsagePeriod(new Date('2026-10-21T00:00:00Z')))

    expect(summary.platformTokens).toBe(6_200)
    expect(summary.orgKeyTokens).toBe(400)
    expect(summary.totalTokens).toBe(6_600)
    expect(summary.platformCostMicros).toBe(3_750)
    expect(summary.orgKeyCostMicros).toBe(900)
    expect(summary.totalCostMicros).toBe(4_650)
    expect(summary.rows[0]).toEqual({
      kind: 'chat_answer',
      keySource: 'platform',
      inputTokens: 1000,
      outputTokens: 200,
      costMicros: 3000,
      calls: 4,
    })

    const query = lastWhereQuery()
    expect(query.sql).toContain('"organization_id" =')
    expect(query.params).toContain(orgId)
  })

  it('sin consumo devuelve ceros', async () => {
    fake.results.push([])
    const summary = await getUsageSummary(orgId)
    expect(summary).toMatchObject({ platformTokens: 0, totalTokens: 0, totalCostMicros: 0, rows: [] })
  })
})

describe('getQuotaStatus', () => {
  it('combina plan, presupuesto y costo con clave de plataforma del mes', async () => {
    fake.results.push([{ planName: 'Profesional', monthlyBudgetMicros: HUNDRED_USD }])
    fake.results.push([{ costMicros: String(usdToMicros(85)) }])

    const status = await getQuotaStatus(orgId, new Date('2026-10-21T10:00:00Z'))

    expect(status).toMatchObject({
      planName: 'Profesional',
      budgetMicros: HUNDRED_USD,
      usedMicros: usdToMicros(85),
      remainingMicros: usdToMicros(15),
      state: 'warning',
    })
    expect(status.period.start.toISOString()).toBe('2026-10-01T00:00:00.000Z')

    // La consulta de consumo cuenta solo la clave de plataforma y solo esta organización.
    const query = lastWhereQuery()
    expect(query.params).toContain(orgId)
    expect(query.params).toContain('platform')
  })

  it('organización sin plan asignado: sin cupo', async () => {
    fake.results.push([{ planName: null, monthlyBudgetMicros: null }])
    fake.results.push([{ costMicros: '123' }])

    const status = await getQuotaStatus(orgId)

    expect(status).toMatchObject({ planName: null, budgetMicros: null, state: 'no_quota', usedMicros: 123 })
  })

  it('organización inexistente o sin eventos no rompe', async () => {
    fake.results.push([])
    fake.results.push([])

    await expect(getQuotaStatus(orgId)).resolves.toMatchObject({ state: 'no_quota', usedMicros: 0 })
  })
})

describe('setOrgPlan', () => {
  it('guarda plan y presupuesto normalizando el nombre', async () => {
    fake.results.push(undefined)
    await setOrgPlan({ orgId, planName: '  Profesional  ', monthlyBudgetMicros: HUNDRED_USD })

    const set = fake.calls.find((call) => call.method === 'set')
    expect(set?.args[0]).toMatchObject({ planName: 'Profesional', monthlyBudgetMicros: HUNDRED_USD })
  })

  it('permite quitar el cupo con null y vaciar el nombre', async () => {
    fake.results.push(undefined)
    await setOrgPlan({ orgId, planName: '   ', monthlyBudgetMicros: null })

    const set = fake.calls.find((call) => call.method === 'set')
    expect(set?.args[0]).toMatchObject({ planName: null, monthlyBudgetMicros: null })
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rechaza un presupuesto inválido (%s)', async (budget) => {
    await expect(setOrgPlan({ orgId, planName: 'x', monthlyBudgetMicros: budget })).rejects.toThrow(
      /non-negative integer/,
    )
    expect(fake.calls.some((call) => call.method === 'set')).toBe(false)
  })
})
