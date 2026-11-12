import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { AccessError, handleApiError, resolveOrProvisionOrganization } from '@ichtys/auth'
import { loadAccessSubject } from '@ichtys/auth/access-subject'
import { ROLES, isRole } from '@ichtys/auth/roles'
import {
  buildOrgLlmKeyStatuses,
  db,
  getOrgLlmApiKeys,
  getOrgRagConfig,
  updateOrgLlmApiKeys,
  updateOrgRagConfig,
  type OrgLlmKeyProvider,
  type OrgLlmProvider,
} from '@ichtys/db'
import {
  AUTO_PROVIDER_CHAIN,
  BILLING_URLS,
  checkAllProviderHealth,
  fetchOpenAiUsageSummary,
  getDefaultProviderPreference,
  isAnthropicConfigured,
  isGoogleConfigured,
  isGroqConfigured,
  isOpenAiConfigured,
  providerLabel,
} from '@ichtys/llm'
import { resolveLlmApiKey } from '@ichtys/db'
import { canChangeOrgSettings } from '../../../../lib/settings/permissions'
import { isProviderChoiceSupported, mergeOrgKeys } from '../../../../lib/settings/provider-guard'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../lib/api/body-limit'
import { patchSchema } from '../../../../lib/api/input-schemas'
import { insertAuditLog } from '../../../../lib/audit/audited-write'

export const runtime = 'nodejs'

function normalizeRole(orgRole: string | null | undefined) {
  if (!orgRole) return ROLES.READ_ONLY_MONITOR
  const stripped = orgRole.replace(/^org:/, '')
  if (stripped === 'admin') return ROLES.ORG_ADMIN
  return isRole(stripped) ? stripped : ROLES.READ_ONLY_MONITOR
}

async function resolveOrgContext() {
  const { userId, orgId: clerkOrgId, orgRole } = await auth()
  if (!userId || !clerkOrgId) {
    throw new AccessError('Unauthorized', 401)
  }

  const org = await resolveOrProvisionOrganization(clerkOrgId)
  if (!org) {
    throw new AccessError('Organization not found', 403)
  }

  const role = normalizeRole(orgRole)
  const access = await loadAccessSubject({ org, userId, role })
  return { userId, orgId: org.id, role, access }
}

/** Hasta el acceso por función, cambiar ajustes pedía rol study_admin o superior. */

/**
 * GET /api/org/settings — configuración RAG/LLM + estado de keys (enmascaradas).
 */
export async function GET(): Promise<Response> {
  try {
    const { orgId } = await resolveOrgContext()
    const [config, orgKeys] = await Promise.all([
      getOrgRagConfig(orgId),
      getOrgLlmApiKeys(orgId),
    ])

    const keyStatuses = buildOrgLlmKeyStatuses(orgKeys)
    const openAiKey = resolveLlmApiKey('openai', orgKeys)
    const openAiUsage = openAiKey ? await fetchOpenAiUsageSummary(openAiKey) : null

    return Response.json({
      llmProvider: config.llmProvider,
      similarityThreshold: config.similarityThreshold,
      topK: config.topK,
      envDefaultProvider: getDefaultProviderPreference(),
      autoChain: AUTO_PROVIDER_CHAIN.map((p) => providerLabel(p)),
      billingUrls: BILLING_URLS,
      llmKeys: keyStatuses,
      openAiUsage,
      providers: {
        anthropic: isAnthropicConfigured(orgKeys),
        openai: isOpenAiConfigured(orgKeys),
        google: isGoogleConfigured(orgKeys),
        groq: isGroqConfigured(orgKeys),
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}

/**
 * PATCH /api/org/settings — proveedor + API keys por org (study_admin+).
 */
export async function PATCH(req: Request): Promise<Response> {
  try {
    const { orgId, userId, access } = await resolveOrgContext()
    if (!canChangeOrgSettings(access)) {
      throw new AccessError('Insufficient role', 403)
    }

    // Tope de bytes ANTES de parsear (413, H7 vuelta 2). El auth ya corrió
    // más arriba; un JSON inválido ahora responde 400 en vez de caer al 500
    // genérico.
    let raw: unknown
    try {
      raw = await readJsonBody(req)
    } catch (err) {
      if (err instanceof JsonBodyTooLargeError) {
        return Response.json({ error: 'Request body too large' }, { status: 413 })
      }
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const body = patchSchema.parse(raw)

    const ragPatch: Partial<{
      llmProvider: OrgLlmProvider
      similarityThreshold: number
      topK: number
    }> = {}
    if (body.llmProvider !== undefined) {
      // Guard (E2E 2026-10-22): un proveedor sin clave disponible deja el
      // chat de la org sin respuestas. Las claves del MISMO request cuentan.
      const currentKeys = await getOrgLlmApiKeys(orgId)
      const effectiveKeys = mergeOrgKeys(currentKeys, body.llmApiKeys)
      if (!isProviderChoiceSupported(body.llmProvider, effectiveKeys)) {
        return Response.json(
          {
            error:
              'El proveedor elegido no tiene una clave disponible. Cargá su clave en este formulario o elegí otro proveedor.',
          },
          { status: 400 },
        )
      }
      ragPatch.llmProvider = body.llmProvider as OrgLlmProvider
    }
    if (body.similarityThreshold !== undefined) ragPatch.similarityThreshold = body.similarityThreshold
    if (body.topK !== undefined) ragPatch.topK = body.topK

    const ragFields = Object.keys(ragPatch) as Array<keyof typeof ragPatch>
    let keysPatch: Partial<Record<OrgLlmKeyProvider, string | null>> | null = null
    if (body.llmApiKeys) {
      keysPatch = {}
      for (const [k, v] of Object.entries(body.llmApiKeys)) {
        if (v !== undefined) keysPatch[k as OrgLlmKeyProvider] = v
      }
    }

    // Cada cambio y su registro se confirman en la misma transacción (R3).
    // Cambiar de proveedor de modelo es un cambio controlado (R6): queda quién
    // lo hizo y a cuál se pasó. De las claves queda el proveedor, nunca la clave.
    if (ragFields.length > 0 || keysPatch) {
      const keys = keysPatch
      // Valores anteriores de lo que cambia: no son secretos y hacen falta para
      // saber qué configuración había y cuál quedó.
      const before = ragFields.length > 0 ? await getOrgRagConfig(orgId) : null
      await db.transaction(async (tx) => {
        if (ragFields.length > 0) {
          await updateOrgRagConfig(orgId, ragPatch, tx)
          await insertAuditLog(tx, {
            action: 'admin.action',
            orgId,
            userId,
            resourceType: 'organization',
            resourceId: orgId,
            metadata: {
              type: 'org.rag_config.updated',
              fields: ragFields,
              ...(ragPatch.llmProvider !== undefined ? { llmProvider: ragPatch.llmProvider } : {}),
              values: Object.fromEntries(ragFields.map((field) => [field, ragPatch[field]])),
              previous: Object.fromEntries(ragFields.map((field) => [field, before?.[field] ?? null])),
            },
          })
        }
        if (keys) {
          await updateOrgLlmApiKeys(orgId, keys, tx)
          await insertAuditLog(tx, {
            action: 'admin.action',
            orgId,
            userId,
            resourceType: 'organization',
            resourceId: orgId,
            // Por proveedor: si la clave se cargó o se quitó. Nunca la clave.
            metadata: {
              type: 'org.llm_keys.updated',
              providers: Object.keys(keys),
              operations: Object.fromEntries(Object.entries(keys).map(([provider, value]) => [provider, value === null || value === '' ? 'removed' : 'set'])),
            },
          })
        }
      })
    }

    const [config, orgKeys] = await Promise.all([
      getOrgRagConfig(orgId),
      getOrgLlmApiKeys(orgId),
    ])

    return Response.json({
      llmProvider: config.llmProvider,
      similarityThreshold: config.similarityThreshold,
      topK: config.topK,
      llmKeys: buildOrgLlmKeyStatuses(orgKeys),
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }
    if (err instanceof Error && err.message.startsWith('Invalid API key')) {
      return Response.json({ error: err.message }, { status: 400 })
    }
    return handleApiError(err)
  }
}

/**
 * POST /api/org/settings/test-providers — prueba conectividad de cada proveedor.
 */
export async function POST(): Promise<Response> {
  try {
    const { orgId, access } = await resolveOrgContext()
    if (!canChangeOrgSettings(access)) {
      throw new AccessError('Insufficient role', 403)
    }

    const orgKeys = await getOrgLlmApiKeys(orgId)
    const health = await checkAllProviderHealth(orgKeys)
    const openAiKey = resolveLlmApiKey('openai', orgKeys)
    const openAiUsage = openAiKey ? await fetchOpenAiUsageSummary(openAiKey) : null

    return Response.json({ health, openAiUsage, checkedAt: new Date().toISOString() })
  } catch (err) {
    return handleApiError(err)
  }
}
