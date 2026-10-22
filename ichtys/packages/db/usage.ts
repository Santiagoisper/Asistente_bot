import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from './client'
import { organizations, usageEvents, type UsageKeySource, type UsageKind } from './schema'
import { estimateCostMicros } from './usage-pricing'

/**
 * usage.ts — medición de consumo y cupo mensual (en dólares estimados) por organización.
 *
 * Reglas:
 *  - Solo conteos y costo estimado. Nunca se guarda ni se loguea contenido (preguntas,
 *    documentos, respuestas).
 *  - recordUsage() NUNCA lanza: si la medición falla, el producto sigue funcionando.
 *  - Toda consulta filtra por organization_id (aislamiento multi-tenant).
 *  - El cupo del plan solo cuenta consumo con clave de la plataforma (key_source = 'platform').
 *  - Importes en micro-USD (1 USD = 1_000_000). Ver usage-pricing.ts.
 */

/** A partir de este porcentaje del cupo se avisa al cliente. */
export const QUOTA_WARNING_RATIO = 0.8
/** integer de Postgres: tope por evento para evitar overflow ante un dato absurdo del proveedor. */
const MAX_TOKENS_PER_EVENT = 2_000_000_000

export interface RecordUsageInput {
  orgId: string
  studyId?: string | null
  userId?: string | null
  kind: UsageKind
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  keySource: UsageKeySource
}

function sanitizeTokens(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(Math.trunc(value), MAX_TOKENS_PER_EVENT)
}

/**
 * Registra una llamada a un modelo con su costo estimado. Nunca lanza ni propaga detalles: un
 * fallo de medición no debe degradar el chat ni la ingesta. No registra eventos sin tokens.
 */
export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const inputTokens = sanitizeTokens(input.inputTokens)
  const outputTokens = sanitizeTokens(input.outputTokens)
  if (inputTokens === 0 && outputTokens === 0) return

  try {
    await db.insert(usageEvents).values({
      organizationId: input.orgId,
      studyId: input.studyId ?? null,
      userId: input.userId ?? null,
      kind: input.kind,
      provider: input.provider,
      model: input.model,
      inputTokens,
      outputTokens,
      costMicros: estimateCostMicros(input.model, inputTokens, outputTokens),
      keySource: input.keySource,
    })
  } catch {
    // Sin detalles: el error de la base podría incluir valores. Solo el hecho de que falló.
    console.warn(`[usage] could not record usage event kind=${input.kind} provider=${input.provider}`)
  }
}

export interface UsagePeriod {
  start: Date
  end: Date
}

/** Mes calendario UTC que contiene `now`: [primer día 00:00Z, primer día del mes siguiente). */
export function getUsagePeriod(now: Date = new Date()): UsagePeriod {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start, end }
}

export type QuotaState = 'no_quota' | 'ok' | 'warning' | 'exceeded'

export interface QuotaEvaluation {
  /** Presupuesto mensual del plan en micro-USD; null = sin cupo definido. */
  budgetMicros: number | null
  /** Costo estimado consumido con clave de la plataforma en el período, micro-USD. */
  usedMicros: number
  remainingMicros: number | null
  percentUsed: number | null
  state: QuotaState
}

/** Función pura: estado del cupo dado el presupuesto del plan y lo consumido con clave de plataforma. */
export function evaluateQuota(budgetMicros: number | null, usedMicros: number): QuotaEvaluation {
  const used = Math.max(0, usedMicros)
  if (budgetMicros === null || budgetMicros <= 0) {
    return { budgetMicros: null, usedMicros: used, remainingMicros: null, percentUsed: null, state: 'no_quota' }
  }

  const remainingMicros = Math.max(0, budgetMicros - used)
  const percentUsed = Math.min(100, Math.round((used / budgetMicros) * 100))
  const state: QuotaState =
    used >= budgetMicros ? 'exceeded' : used >= budgetMicros * QUOTA_WARNING_RATIO ? 'warning' : 'ok'
  return { budgetMicros, usedMicros: used, remainingMicros, percentUsed, state }
}

export interface UsageBreakdownRow {
  kind: UsageKind
  keySource: UsageKeySource
  inputTokens: number
  outputTokens: number
  costMicros: number
  calls: number
}

export interface UsageSummary {
  period: UsagePeriod
  rows: UsageBreakdownRow[]
  platformTokens: number
  orgKeyTokens: number
  totalTokens: number
  platformCostMicros: number
  orgKeyCostMicros: number
  totalCostMicros: number
}

export async function getUsageSummary(
  orgId: string,
  period: UsagePeriod = getUsagePeriod(),
): Promise<UsageSummary> {
  const rows = await db
    .select({
      kind: usageEvents.kind,
      keySource: usageEvents.keySource,
      inputTokens: sql<string>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
      outputTokens: sql<string>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
      costMicros: sql<string>`coalesce(sum(${usageEvents.costMicros}), 0)`,
      calls: sql<string>`count(*)`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.organizationId, orgId),
        gte(usageEvents.createdAt, period.start),
        lt(usageEvents.createdAt, period.end),
      ),
    )
    .groupBy(usageEvents.kind, usageEvents.keySource)

  const breakdown: UsageBreakdownRow[] = rows.map((row) => ({
    kind: row.kind,
    keySource: row.keySource,
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    costMicros: Number(row.costMicros),
    calls: Number(row.calls),
  }))

  let platformTokens = 0
  let orgKeyTokens = 0
  let platformCostMicros = 0
  let orgKeyCostMicros = 0
  for (const row of breakdown) {
    const tokens = row.inputTokens + row.outputTokens
    if (row.keySource === 'platform') {
      platformTokens += tokens
      platformCostMicros += row.costMicros
    } else {
      orgKeyTokens += tokens
      orgKeyCostMicros += row.costMicros
    }
  }

  return {
    period,
    rows: breakdown,
    platformTokens,
    orgKeyTokens,
    totalTokens: platformTokens + orgKeyTokens,
    platformCostMicros,
    orgKeyCostMicros,
    totalCostMicros: platformCostMicros + orgKeyCostMicros,
  }
}

export interface QuotaStatus extends QuotaEvaluation {
  planName: string | null
  period: UsagePeriod
}

/** Estado del cupo del mes en curso para una organización (lectura barata, 2 consultas). */
export async function getQuotaStatus(orgId: string, now: Date = new Date()): Promise<QuotaStatus> {
  const period = getUsagePeriod(now)

  const [org] = await db
    .select({ planName: organizations.planName, monthlyBudgetMicros: organizations.monthlyBudgetMicros })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)

  const [usage] = await db
    .select({ costMicros: sql<string>`coalesce(sum(${usageEvents.costMicros}), 0)` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.organizationId, orgId),
        eq(usageEvents.keySource, 'platform'),
        gte(usageEvents.createdAt, period.start),
        lt(usageEvents.createdAt, period.end),
      ),
    )

  const evaluation = evaluateQuota(org?.monthlyBudgetMicros ?? null, Number(usage?.costMicros ?? 0))
  return { ...evaluation, planName: org?.planName ?? null, period }
}

/**
 * ¿Puede esta organización seguir usando la clave de la plataforma? Solo se bloquea cuando hay
 * un cupo definido y está agotado. Con clave propia de la organización nunca se bloquea.
 */
export function canUsePlatformKey(status: Pick<QuotaEvaluation, 'state'>): boolean {
  return status.state !== 'exceeded'
}

export interface SetOrgPlanInput {
  orgId: string
  planName: string | null
  /** Presupuesto mensual en micro-USD (usar usdToMicros(100) para 100 USD); null = sin cupo. */
  monthlyBudgetMicros: number | null
}

/** Asigna plan y cupo a una organización. Validación estricta: entero >= 0 o null. */
export async function setOrgPlan(input: SetOrgPlanInput): Promise<void> {
  const { monthlyBudgetMicros } = input
  if (monthlyBudgetMicros !== null && (!Number.isSafeInteger(monthlyBudgetMicros) || monthlyBudgetMicros < 0)) {
    throw new Error('monthlyBudgetMicros must be a non-negative integer or null')
  }
  const planName = input.planName?.trim().slice(0, 80) || null

  await db
    .update(organizations)
    .set({ planName, monthlyBudgetMicros, updatedAt: new Date() })
    .where(eq(organizations.id, input.orgId))
}
