import {
  and,
  clinicalEvolutions,
  db,
  eq,
  isNull,
  memberFunctions,
  organizations,
  studies,
  studyMemberships,
  type MemberFunction,
} from '@ichtys/db'
import { parseMemberFunctions } from '@ichtys/auth/functions'
import type { DbExecutor, DbTransaction } from '../audit/audited-write'

/**
 * Lecturas y escrituras de «Equipo y accesos» (docs/decisions/study-membership.md).
 * Toda consulta lleva la organización: ninguna función de acá recibe un
 * identificador suelto. Las bajas marcan `revoked_at` y no borran la fila.
 * Las escrituras reciben la transacción de `auditedWrite`: el cambio y su
 * registro se confirman juntos (R3).
 */

export interface TeamSnapshot {
  functions: Array<{ userId: string; functionKey: MemberFunction; grantedBy: string; grantedAt: Date }>
  memberships: Array<{ userId: string; studyId: string; studyLabel: string | null; expiresAt: Date | null }>
  studies: Array<{ id: string; name: string }>
  /** Quienes escribieron alguna evolución: de acá sale a quién afecta el modo estricto (M15). */
  evolutionAuthors: string[]
}

export async function loadTeamSnapshot(orgId: string): Promise<TeamSnapshot> {
  const [functionRows, membershipRows, studyRows, authorRows] = await Promise.all([
    db
      .select({
        userId: memberFunctions.userId,
        functionKey: memberFunctions.functionKey,
        grantedBy: memberFunctions.grantedBy,
        grantedAt: memberFunctions.grantedAt,
      })
      .from(memberFunctions)
      .where(and(eq(memberFunctions.organizationId, orgId), isNull(memberFunctions.revokedAt))),
    db
      .select({
        userId: studyMemberships.userId,
        studyId: studyMemberships.studyId,
        studyLabel: studyMemberships.studyLabel,
        expiresAt: studyMemberships.expiresAt,
      })
      .from(studyMemberships)
      .where(and(eq(studyMemberships.organizationId, orgId), isNull(studyMemberships.revokedAt))),
    db.select({ id: studies.id, name: studies.name }).from(studies).where(eq(studies.organizationId, orgId)),
    db
      .selectDistinct({ userId: clinicalEvolutions.authorUserId })
      .from(clinicalEvolutions)
      .where(eq(clinicalEvolutions.organizationId, orgId)),
  ])

  return {
    // Un nombre que este código no conoce no se muestra como función válida.
    functions: functionRows.filter((row) => parseMemberFunctions([row.functionKey]).known.length === 1),
    memberships: membershipRows,
    studies: studyRows,
    evolutionAuthors: authorRows.map((row) => row.userId),
  }
}

/** Funciones vigentes de una persona, para las reglas que dependen de ellas (M4). */
export async function loadActiveFunctions(
  executor: DbExecutor,
  params: { orgId: string; userId: string },
): Promise<MemberFunction[]> {
  const rows = await executor
    .select({ functionKey: memberFunctions.functionKey })
    .from(memberFunctions)
    .where(
      and(
        eq(memberFunctions.organizationId, params.orgId),
        eq(memberFunctions.userId, params.userId),
        isNull(memberFunctions.revokedAt),
      ),
    )
  return parseMemberFunctions(rows.map((row) => row.functionKey)).known
}

export async function grantFunction(
  tx: DbTransaction,
  params: { orgId: string; userId: string; functionKey: MemberFunction; actorId: string },
): Promise<{ changed: boolean }> {
  // El índice único parcial (una fila vigente por persona y función) decide: si
  // ya la tenía, no se inserta nada y no es un error.
  const inserted = await tx
    .insert(memberFunctions)
    .values({
      organizationId: params.orgId,
      userId: params.userId,
      functionKey: params.functionKey,
      grantedBy: params.actorId,
    })
    .onConflictDoNothing()
    .returning({ id: memberFunctions.id })
  return { changed: inserted.length > 0 }
}

export async function revokeFunction(
  tx: DbTransaction,
  params: { orgId: string; userId: string; functionKey: MemberFunction; actorId: string },
): Promise<{ changed: boolean }> {
  const revoked = await tx
    .update(memberFunctions)
    .set({ revokedAt: new Date(), revokedBy: params.actorId })
    .where(
      and(
        eq(memberFunctions.organizationId, params.orgId),
        eq(memberFunctions.userId, params.userId),
        eq(memberFunctions.functionKey, params.functionKey),
        isNull(memberFunctions.revokedAt),
      ),
    )
    .returning({ id: memberFunctions.id })
  return { changed: revoked.length > 0 }
}

export async function upsertMembership(
  tx: DbTransaction,
  params: {
    orgId: string
    studyId: string
    userId: string
    studyLabel: string | null
    expiresAt: Date | null
    actorId: string
  },
): Promise<{ outcome: 'granted' | 'updated' }> {
  const active = and(
    eq(studyMemberships.organizationId, params.orgId),
    eq(studyMemberships.studyId, params.studyId),
    eq(studyMemberships.userId, params.userId),
    isNull(studyMemberships.revokedAt),
  )
  const updated = await tx
    .update(studyMemberships)
    .set({ studyLabel: params.studyLabel, expiresAt: params.expiresAt })
    .where(active)
    .returning({ id: studyMemberships.id })
  if (updated.length > 0) return { outcome: 'updated' }

  await tx.insert(studyMemberships).values({
    organizationId: params.orgId,
    studyId: params.studyId,
    userId: params.userId,
    studyLabel: params.studyLabel,
    expiresAt: params.expiresAt,
    createdBy: params.actorId,
  })
  return { outcome: 'granted' }
}

export async function revokeMembership(
  tx: DbTransaction,
  params: { orgId: string; studyId: string; userId: string; actorId: string },
): Promise<{ changed: boolean }> {
  const revoked = await tx
    .update(studyMemberships)
    .set({ revokedAt: new Date(), revokedBy: params.actorId })
    .where(
      and(
        eq(studyMemberships.organizationId, params.orgId),
        eq(studyMemberships.studyId, params.studyId),
        eq(studyMemberships.userId, params.userId),
        isNull(studyMemberships.revokedAt),
      ),
    )
    .returning({ id: studyMemberships.id })
  return { changed: revoked.length > 0 }
}

/**
 * Cambia el modo de acceso de la organización (M5/M8 y «Cambio de modo»).
 * La columna tiene dos valores, así que pedir el contrario del actual decide
 * el cambio: pedir el modo que ya rige no toca nada y devuelve changed:false.
 */
export async function setOrgAccessMode(
  tx: DbTransaction,
  params: { orgId: string; mode: 'open' | 'enforced' },
): Promise<{ changed: boolean }> {
  const updated = await tx
    .update(organizations)
    .set({ accessMode: params.mode })
    .where(
      and(
        eq(organizations.id, params.orgId),
        eq(organizations.accessMode, params.mode === 'open' ? 'enforced' : 'open'),
      ),
    )
    .returning({ id: organizations.id })
  return { changed: updated.length > 0 }
}

/** Fija el plazo del modo abierto la primera vez que se administra el equipo (M5). Nunca pisa una fecha existente. */
export async function assignOpenDeadline(
  tx: DbTransaction,
  params: { orgId: string; until: Date },
): Promise<{ assigned: boolean }> {
  const updated = await tx
    .update(organizations)
    .set({ accessOpenUntil: params.until })
    .where(and(eq(organizations.id, params.orgId), isNull(organizations.accessOpenUntil)))
    .returning({ id: organizations.id })
  return { assigned: updated.length > 0 }
}
