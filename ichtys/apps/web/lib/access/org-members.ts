import { clerkClient } from '@clerk/nextjs/server'
import { normalizeRole, type Role } from '@ichtys/auth/roles'

/**
 * Las personas de una organización viven en el proveedor de identidad
 * (docs/decisions/study-membership.md): la base solo guarda su identificador.
 */
export interface OrgMember {
  userId: string
  /** Nombre para mostrar. Null si el proveedor no lo tiene. */
  name: string | null
  /** Correo o usuario con el que entra. */
  identifier: string | null
  /** Rol histórico. Solo decide en modo `open`. */
  role: Role
}

const PAGE = 100
/** Tope de resguardo: un centro con más personas necesita paginar en pantalla. */
const MAX_MEMBERS = 500

type ClerkMembership = {
  role: string
  publicUserData?: { userId?: string; firstName?: string | null; lastName?: string | null; identifier?: string } | null
}

function toMember(membership: ClerkMembership): OrgMember | null {
  const data = membership.publicUserData
  if (!data?.userId) return null
  const name = [data.firstName, data.lastName].filter(Boolean).join(' ').trim()
  return {
    userId: data.userId,
    name: name.length > 0 ? name : null,
    identifier: data.identifier ?? null,
    role: normalizeRole(membership.role),
  }
}

export async function listOrgMembers(clerkOrgId: string): Promise<{ members: OrgMember[]; truncated: boolean }> {
  const client = await clerkClient()
  const members: OrgMember[] = []
  let total = 0
  for (let offset = 0; offset < MAX_MEMBERS; offset += PAGE) {
    const page = await client.organizations.getOrganizationMembershipList({
      organizationId: clerkOrgId,
      limit: PAGE,
      offset,
    })
    total = page.totalCount
    for (const membership of page.data) {
      const member = toMember(membership)
      if (member) members.push(member)
    }
    if (page.data.length < PAGE) break
  }
  return { members, truncated: total > members.length }
}

/** La persona, si pertenece a la organización. Una función no se asigna a un identificador ajeno. */
export async function findOrgMember(clerkOrgId: string, userId: string): Promise<OrgMember | null> {
  const client = await clerkClient()
  const page = await client.organizations.getOrganizationMembershipList({
    organizationId: clerkOrgId,
    userId: [userId],
    limit: 1,
  })
  const member = page.data[0] ? toMember(page.data[0]) : null
  // El filtro lo aplica el proveedor; se vuelve a comprobar acá para no depender de eso.
  return member && member.userId === userId ? member : null
}
