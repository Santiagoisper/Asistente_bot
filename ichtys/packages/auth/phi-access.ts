import { auth } from '@clerk/nextjs/server'
import { and, eq } from 'drizzle-orm'
import {
  db,
  organizations,
  studies,
  subjects,
  type Study,
  type Subject,
} from '@ichtys/db'
import { canAccessPhiData, isRole, type Role } from './roles'
import { AccessError, type StudyAccessContext } from './validate-study-access'

function normalizeRole(orgRole: string | null | undefined): Role {
  if (!orgRole) return 'read_only_monitor'
  const stripped = orgRole.replace(/^org:/, '')
  if (stripped === 'admin') return 'org_admin'
  return isRole(stripped) ? stripped : 'read_only_monitor'
}

/**
 * Valida acceso al estudio + permiso PHI (coordinador, PI, study_admin, org_admin).
 */
export async function validatePhiStudyAccess(studyId: string): Promise<StudyAccessContext> {
  const { userId, orgId: clerkOrgId, orgRole } = await auth()

  if (!userId || !clerkOrgId) {
    throw new AccessError('Unauthorized', 401)
  }

  const role = normalizeRole(orgRole)
  if (!canAccessPhiData(role)) {
    throw new AccessError('Forbidden', 403)
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  })

  if (!org) {
    throw new AccessError('Organization not found', 403)
  }

  const study = await db.query.studies.findFirst({
    where: and(eq(studies.id, studyId), eq(studies.organizationId, org.id)),
  })

  if (!study) {
    throw new AccessError('Study not found or access denied', 404)
  }

  return { userId, orgId: org.id, study }
}

export interface SubjectAccessContext extends StudyAccessContext {
  subject: Subject
}

/**
 * Valida que el sujeto pertenece a org + study activos.
 */
export async function validateSubjectAccess(subjectId: string): Promise<SubjectAccessContext> {
  const { userId, orgId: clerkOrgId, orgRole } = await auth()

  if (!userId || !clerkOrgId) {
    throw new AccessError('Unauthorized', 401)
  }

  const role = normalizeRole(orgRole)
  if (!canAccessPhiData(role)) {
    throw new AccessError('Forbidden', 403)
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  })

  if (!org) {
    throw new AccessError('Organization not found', 403)
  }

  const subject = await db.query.subjects.findFirst({
    where: and(eq(subjects.id, subjectId), eq(subjects.organizationId, org.id)),
  })

  if (!subject) {
    throw new AccessError('Not Found', 404)
  }

  const study = await db.query.studies.findFirst({
    where: and(eq(studies.id, subject.studyId), eq(studies.organizationId, org.id)),
  })

  if (!study) {
    throw new AccessError('Not Found', 404)
  }

  return { userId, orgId: org.id, study, subject }
}

export type { Study }
