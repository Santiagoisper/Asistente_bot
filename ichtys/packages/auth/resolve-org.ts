import { clerkClient } from '@clerk/nextjs/server'
import { eq } from 'drizzle-orm'
import { db, organizations, type Organization } from '@ichtys/db'

/**
 * Resuelve la org interna desde el clerk_org_id del token.
 * Si no existe en DB, la provisiona on-the-fly (JIT) desde Clerk.
 */
export async function resolveOrProvisionOrganization(
  clerkOrgId: string,
): Promise<Organization | null> {
  const existing = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  })
  if (existing) return existing

  let orgName = clerkOrgId
  try {
    const client = await clerkClient()
    const clerkOrg = await client.organizations.getOrganization({ organizationId: clerkOrgId })
    orgName = clerkOrg.name || clerkOrgId
  } catch {
    console.warn(
      `[auth] Could not fetch org name from Clerk for ${clerkOrgId} — using ID as name`,
    )
  }

  const [provisioned] = await db
    .insert(organizations)
    .values({ clerkOrgId, name: orgName })
    .returning()

  if (provisioned) {
    console.info(`[auth] JIT-provisioned org "${orgName}" (${clerkOrgId})`)
  }

  return provisioned ?? null
}
