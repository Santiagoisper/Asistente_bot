import { auth } from '@clerk/nextjs/server'
import { AccessError, resolveOrProvisionOrganization } from '@ichtys/auth'
import { loadAccessSubject } from '@ichtys/auth/access-subject'
import type { AccessSubject } from '@ichtys/auth/functions'
import { normalizeRole, type Role } from '@ichtys/auth/roles'

export interface OrgAccessContext {
  userId: string
  clerkOrgId: string
  orgId: string
  role: Role
  access: AccessSubject
  accessOpenUntil: Date | null
}

/** Sesión, organización y capacidades de quien llama. Sin sesión u organización: 401. */
export async function resolveOrgAccessContext(): Promise<OrgAccessContext> {
  const { userId, orgId: clerkOrgId, orgRole } = await auth()
  if (!userId || !clerkOrgId) throw new AccessError('Unauthorized', 401)

  const org = await resolveOrProvisionOrganization(clerkOrgId)
  if (!org) throw new AccessError('Organization not found', 403)

  const role = normalizeRole(orgRole)
  const access = await loadAccessSubject({ org, userId, role })
  return { userId, clerkOrgId, orgId: org.id, role, access, accessOpenUntil: org.accessOpenUntil ?? null }
}
