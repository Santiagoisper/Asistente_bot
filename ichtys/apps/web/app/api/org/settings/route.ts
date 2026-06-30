import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { AccessError, handleApiError, resolveOrProvisionOrganization } from '@ichtys/auth'
import { ROLES, isRole, roleSatisfies } from '@ichtys/auth/roles'
import {
  auditLogs,
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
  isGlmConfigured,
  isGoogleConfigured,
  isGroqConfigured,
  isOpenAiConfigured,
  providerLabel,
} from '@ichtys/llm'
import { resolveLlmApiKey } from '@ichtys/db'

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

  return { userId, orgId: org.id, role: normalizeRole(orgRole) }
}

const patchSchema = z.object({
  llmProvider: z.enum(['anthropic', 'openai', 'google', 'groq', 'glm', 'auto']).optional(),
  llmApiKeys: z
    .object({
      anthropic: z.string().min(8).nullable().optional(),
      openai: z.string().min(8).nullable().optional(),
      google: z.string().min(8).nullable().optional(),
      groq: z.string().min(8).nullable().optional(),
      openrouter: z.string().min(8).nullable().optional(),
    })
    .optional(),
})

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
        glm: isGlmConfigured(orgKeys),
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
    const { orgId, userId, role } = await resolveOrgContext()
    if (!roleSatisfies(role, ROLES.STUDY_ADMIN)) {
      throw new AccessError('Insufficient role', 403)
    }

    const body = patchSchema.parse(await req.json())

    if (body.llmProvider !== undefined) {
      await updateOrgRagConfig(orgId, {
        llmProvider: body.llmProvider as OrgLlmProvider,
      })
    }

    if (body.llmApiKeys) {
      const patch: Partial<Record<OrgLlmKeyProvider, string | null>> = {}
      for (const [k, v] of Object.entries(body.llmApiKeys)) {
        if (v !== undefined) patch[k as OrgLlmKeyProvider] = v
      }
      await updateOrgLlmApiKeys(orgId, patch)

      await dbInsertAudit(orgId, userId, Object.keys(patch))
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

async function dbInsertAudit(orgId: string, userId: string, providers: string[]) {
  await db.insert(auditLogs).values({
    organizationId: orgId,
    userId,
    action: 'admin.action',
    resourceType: 'organization',
    resourceId: orgId,
    metadata: { type: 'org.llm_keys.updated', providers },
  })
}

/**
 * POST /api/org/settings/test-providers — prueba conectividad de cada proveedor.
 */
export async function POST(): Promise<Response> {
  try {
    const { orgId, role } = await resolveOrgContext()
    if (!roleSatisfies(role, ROLES.STUDY_ADMIN)) {
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
