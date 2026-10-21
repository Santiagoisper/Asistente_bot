import { auth } from '@clerk/nextjs/server'
import { AccessError, handleApiError, resolveOrProvisionOrganization } from '@ichtys/auth'
import {
  getQuotaStatus,
  getUsageSummary,
  microsToUsd,
  QUOTA_WARNING_RATIO,
  type UsageKind,
} from '@ichtys/db'

export const runtime = 'nodejs'

async function resolveOrgId(): Promise<string> {
  const { userId, orgId: clerkOrgId } = await auth()
  if (!userId || !clerkOrgId) {
    throw new AccessError('Unauthorized', 401)
  }

  const org = await resolveOrProvisionOrganization(clerkOrgId)
  if (!org) {
    throw new AccessError('Organization not found', 403)
  }

  return org.id
}

/** Etiquetas legibles para el desglose por tipo — nunca se muestra el `kind` crudo al cliente. */
const KIND_LABELS: Record<UsageKind, string> = {
  chat_answer: 'Respuestas del chat',
  chat_eval: 'Evaluación de confianza',
  chat_title: 'Título de conversación',
  spec_extraction: 'Lectura de protocolo',
  clinical_extraction: 'Extracción clínica',
  embedding_document: 'Indexado de documentos',
  embedding_query: 'Búsquedas',
}

/**
 * GET /api/org/usage — cupo mensual y desglose de consumo para la organización activa.
 * Cualquier miembro de la org puede verlo (transparencia de consumo para el cliente).
 */
export async function GET(): Promise<Response> {
  try {
    const orgId = await resolveOrgId()
    const [quota, summary] = await Promise.all([getQuotaStatus(orgId), getUsageSummary(orgId)])

    return Response.json({
      plan: {
        name: quota.planName,
        budgetUsd: quota.budgetMicros !== null ? microsToUsd(quota.budgetMicros) : null,
      },
      period: { start: summary.period.start.toISOString(), end: summary.period.end.toISOString() },
      quota: {
        state: quota.state,
        usedUsd: microsToUsd(quota.usedMicros),
        remainingUsd: quota.remainingMicros !== null ? microsToUsd(quota.remainingMicros) : null,
        percentUsed: quota.percentUsed,
        warningRatio: QUOTA_WARNING_RATIO,
      },
      breakdown: summary.rows.map((row) => ({
        kind: row.kind,
        label: KIND_LABELS[row.kind] ?? row.kind,
        keySource: row.keySource,
        calls: row.calls,
        tokens: row.inputTokens + row.outputTokens,
        costUsd: microsToUsd(row.costMicros),
      })),
      totals: {
        platformUsd: microsToUsd(summary.platformCostMicros),
        orgKeyUsd: microsToUsd(summary.orgKeyCostMicros),
        totalUsd: microsToUsd(summary.totalCostMicros),
        platformTokens: summary.platformTokens,
        orgKeyTokens: summary.orgKeyTokens,
        totalTokens: summary.totalTokens,
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
