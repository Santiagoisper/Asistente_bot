import {
  microsToUsd,
  type QuotaState,
  type QuotaStatus,
  type UsageKind,
  type UsageSummary,
} from '@ichtys/db'

/**
 * usage-view.ts — convierte el consumo y el cupo del mes en lo que ve el cliente.
 *
 * Función pura (sin red ni base de datos): fácil de probar. Los importes son ESTIMADOS: se
 * calculan con una tabla de precios por modelo, no son la factura del proveedor.
 */

export const USAGE_KIND_LABELS: Record<UsageKind, string> = {
  chat_answer: 'Respuestas del chat',
  chat_eval: 'Evaluación de confianza de respuestas',
  chat_title: 'Títulos de conversaciones',
  spec_extraction: 'Extracción de la especificación del protocolo',
  clinical_extraction: 'Extracción de datos clínicos',
  embedding_document: 'Indexación de documentos',
  embedding_query: 'Búsqueda en los documentos',
}

export interface UsageViewRow {
  kind: UsageKind
  label: string
  /** USD estimados con clave de la plataforma (cuentan contra el cupo). */
  platformUsd: number
  /** USD estimados con clave propia de la organización (no cuentan contra el cupo). */
  orgKeyUsd: number
  tokens: number
  calls: number
}

export interface UsageViewModel {
  /** Mes en curso, p. ej. "octubre de 2026". */
  periodLabel: string
  quota: {
    planName: string | null
    state: QuotaState
    budgetUsd: number | null
    usedUsd: number
    remainingUsd: number | null
    percentUsed: number | null
    message: string
  }
  rows: UsageViewRow[]
  totals: {
    platformUsd: number
    orgKeyUsd: number
    totalUsd: number
    totalTokens: number
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function quotaMessage(state: QuotaState, percentUsed: number | null): string {
  switch (state) {
    case 'no_quota':
      return 'Tu organización no tiene un cupo mensual definido: no hay límite de consumo.'
    case 'ok':
      return 'Estás dentro de tu cupo mensual.'
    case 'warning':
      return `Ya usaste el ${percentUsed ?? 80} % de tu cupo mensual. Podés cargar tu propia clave de IA en Ajustes para no depender del cupo.`
    case 'exceeded':
      return 'Agotaste el cupo mensual. Cargá tu propia clave de IA en Ajustes o ampliá tu plan para seguir usando la clave de la plataforma.'
  }
}

export function buildUsageView(quota: QuotaStatus, summary: UsageSummary): UsageViewModel {
  const byKind = new Map<UsageKind, UsageViewRow>()

  for (const row of summary.rows) {
    const current =
      byKind.get(row.kind) ??
      ({
        kind: row.kind,
        label: USAGE_KIND_LABELS[row.kind],
        platformUsd: 0,
        orgKeyUsd: 0,
        tokens: 0,
        calls: 0,
      } satisfies UsageViewRow)

    const usd = microsToUsd(row.costMicros)
    if (row.keySource === 'platform') current.platformUsd += usd
    else current.orgKeyUsd += usd
    current.tokens += row.inputTokens + row.outputTokens
    current.calls += row.calls
    byKind.set(row.kind, current)
  }

  const rows = [...byKind.values()]
    .map((row) => ({ ...row, platformUsd: round2(row.platformUsd), orgKeyUsd: round2(row.orgKeyUsd) }))
    .sort((a, b) => b.platformUsd + b.orgKeyUsd - (a.platformUsd + a.orgKeyUsd))

  const platformUsd = round2(microsToUsd(summary.platformCostMicros))
  const orgKeyUsd = round2(microsToUsd(summary.orgKeyCostMicros))

  return {
    periodLabel: quota.period.start.toLocaleDateString('es-AR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    quota: {
      planName: quota.planName,
      state: quota.state,
      budgetUsd: quota.budgetMicros === null ? null : round2(microsToUsd(quota.budgetMicros)),
      usedUsd: round2(microsToUsd(quota.usedMicros)),
      remainingUsd: quota.remainingMicros === null ? null : round2(microsToUsd(quota.remainingMicros)),
      percentUsed: quota.percentUsed,
      message: quotaMessage(quota.state, quota.percentUsed),
    },
    rows,
    totals: {
      platformUsd,
      orgKeyUsd,
      totalUsd: round2(platformUsd + orgKeyUsd),
      totalTokens: summary.totalTokens,
    },
  }
}
