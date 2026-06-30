import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { AccessError, handleApiError } from '@ichtys/auth'
import { ROLES, isRole, roleSatisfies } from '@ichtys/auth/roles'
import {
  db,
  eq,
  getOrgRagConfig,
  organizations,
  updateOrgRagConfig,
  type OrgLlmProvider,
} from '@ichtys/db'
import {
  getDefaultProviderPreference,
  isAnthropicConfigured,
  isGoogleConfigured,
} from '@ichtys/llm'

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

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  })
  if (!org) {
    throw new AccessError('Organization not found', 403)
  }

  return { userId, orgId: org.id, role: normalizeRole(orgRole) }
}

const patchSchema = z.object({
  llmProvider: z.enum(['anthropic', 'google', 'auto']).optional(),
})

/**
 * GET /api/org/settings — configuración RAG/LLM de la organización activa.
 */
export async function GET(): Promise<Response> {
  try {
    const { orgId } = await resolveOrgContext()
    const config = await getOrgRagConfig(orgId)

    return Response.json({
      llmProvider: config.llmProvider,
      similarityThreshold: config.similarityThreshold,
      topK: config.topK,
      envDefaultProvider: getDefaultProviderPreference(),
      providers: {
        anthropic: isAnthropicConfigured(),
        google: isGoogleConfigured(),
      },
    })
  } catch (err) {
    return handleApiError(err)
  }
}

/**
 * PATCH /api/org/settings — actualiza preferencias (study_admin+).
 */
export async function PATCH(req: Request): Promise<Response> {
  try {
    const { orgId, role } = await resolveOrgContext()
    if (!roleSatisfies(role, ROLES.STUDY_ADMIN)) {
      throw new AccessError('Insufficient role', 403)
    }

    const body = patchSchema.parse(await req.json())
    const updated = await updateOrgRagConfig(orgId, {
      llmProvider: body.llmProvider as OrgLlmProvider | undefined,
    })

    return Response.json({
      llmProvider: updated.llmProvider,
      similarityThreshold: updated.similarityThreshold,
      topK: updated.topK,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }
    return handleApiError(err)
  }
}
