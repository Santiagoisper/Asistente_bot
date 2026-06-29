import { z } from 'zod'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { db, eq, organizations, studies } from '@ichtys/db'
import { handleApiError } from '@ichtys/auth'

export const runtime = 'nodejs'

const createStudyInput = z.object({
  name: z.string().min(1).max(200),
  protocolNumber: z.string().max(100).optional(),
})

/**
 * Resolves the ALPHI org record for the given Clerk org ID.
 * If the org is not in the DB yet (first use after a new Clerk org is created),
 * provisions it on-the-fly (JIT provisioning). This avoids manual DB inserts
 * when a new Clerk organization starts using ALPHI.
 */
async function resolveOrProvisionOrg(clerkOrgId: string) {
  const existing = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  })
  if (existing) return existing

  // Org not in DB yet — provision it from Clerk metadata.
  let orgName = clerkOrgId
  try {
    const client = await clerkClient()
    const clerkOrg = await client.organizations.getOrganization({ organizationId: clerkOrgId })
    orgName = clerkOrg.name || clerkOrgId
  } catch {
    // Non-critical: fall back to using clerkOrgId as the name.
    console.warn(`[studies/route] Could not fetch org name from Clerk for ${clerkOrgId} — using ID as name`)
  }

  const [provisioned] = await db
    .insert(organizations)
    .values({ clerkOrgId, name: orgName })
    .returning()

  if (!provisioned) throw new Error('Failed to provision organization')
  console.info(`[studies/route] JIT-provisioned org "${orgName}" (${clerkOrgId})`)
  return provisioned
}

export async function POST(req: Request): Promise<Response> {
  const { userId, orgId: clerkOrgId } = await auth()
  if (!userId || !clerkOrgId) {
    return new Response('Unauthorized', { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  const parsed = createStudyInput.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const org = await resolveOrProvisionOrg(clerkOrgId)

    const [study] = await db
      .insert(studies)
      .values({
        organizationId: org.id,
        name: parsed.data.name,
        protocolNumber: parsed.data.protocolNumber ?? null,
        status: 'active',
      })
      .returning()

    if (!study) throw new Error('Insert did not return a row')

    return Response.json(
      { id: study.id, name: study.name, protocolNumber: study.protocolNumber, status: study.status },
      { status: 201 },
    )
  } catch (err) {
    return handleApiError(err)
  }
}
