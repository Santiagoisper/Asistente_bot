import { auth } from '@clerk/nextjs/server'
import { and, eq } from 'drizzle-orm'
import {
  db,
  organizations,
  studies,
  subjects,
  type Subject,
} from '@ichtys/db'
import { loadAccessSubject } from './access-subject'
import { allows, type Capability } from './functions'
import { canAccessPhiData, normalizeRole } from './roles'
import { AccessError, assertStudyMembership, type StudyAccessContext } from './validate-study-access'

export interface ClinicalAccessOptions {
  /**
   * Capacidad adicional que la ruta exige en modo estricto, además de ver
   * datos clínicos: `clinical.author` para escribir una evolución,
   * `labs.manage` para cargar o confirmar un laboratorio, `agenda.manage` para
   * mover un turno. Ver datos no es poder cambiarlos: toda ruta que MODIFICA
   * nombra la suya. En modo `open` no agrega nada: históricamente, quien podía
   * ver datos clínicos podía también hacer lo que hoy pide esta capacidad.
   */
  require?: Capability
}

/** En modo `open` la capacidad adicional no existía como comprobación aparte. */
const NO_EXTRA_CHECK = (): boolean => true

/**
 * Valida acceso al estudio + datos clínicos.
 * Modo `open`: por rol (coordinador, PI, study_admin, org_admin), como siempre.
 * Modo estricto: capacidad `clinical.read` de las funciones de la persona.
 */
export async function validatePhiStudyAccess(
  studyId: string,
  options: ClinicalAccessOptions = {},
): Promise<StudyAccessContext> {
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

  const role = normalizeRole(orgRole)
  const access = await loadAccessSubject({ org, userId, role })
  if (!allows(access, 'clinical.read', canAccessPhiData)) {
    throw new AccessError('Forbidden', 403)
  }
  if (options.require && !allows(access, options.require, NO_EXTRA_CHECK)) {
    throw new AccessError('Forbidden', 403)
  }

  const study = await db.query.studies.findFirst({
    where: and(eq(studies.id, studyId), eq(studies.organizationId, org.id)),
  })

  if (!study) {
    throw new AccessError('Study not found or access denied', 404)
  }

  await assertStudyMembership({ access, orgId: org.id, studyId: study.id, userId })

  return { userId, orgId: org.id, study, role, access }
}

export interface SubjectAccessContext extends StudyAccessContext {
  subject: Subject
}

export type SubjectAccessOptions = ClinicalAccessOptions

/**
 * Valida que el sujeto pertenece a la org activa y al estudio de la URL.
 * `expectedStudyId` es obligatorio: sin él no se lee el sujeto.
 */
export async function validateSubjectAccess(
  subjectId: string,
  expectedStudyId: string,
  options: SubjectAccessOptions = {},
): Promise<SubjectAccessContext> {
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

  const role = normalizeRole(orgRole)
  const access = await loadAccessSubject({ org, userId, role })
  if (!allows(access, 'clinical.read', canAccessPhiData)) {
    throw new AccessError('Forbidden', 403)
  }
  if (options.require && !allows(access, options.require, NO_EXTRA_CHECK)) {
    throw new AccessError('Forbidden', 403)
  }

  if (!expectedStudyId) {
    throw new AccessError('Not Found', 404)
  }

  const subject = await db.query.subjects.findFirst({
    where: and(eq(subjects.id, subjectId), eq(subjects.organizationId, org.id)),
  })

  if (!subject) {
    throw new AccessError('Not Found', 404)
  }

  // El [id] de la URL tiene que ser el estudio del sujeto antes de leer, escribir o auditar.
  if (subject.studyId !== expectedStudyId) {
    throw new AccessError('Not Found', 404)
  }

  const study = await db.query.studies.findFirst({
    where: and(eq(studies.id, subject.studyId), eq(studies.organizationId, org.id)),
  })

  if (!study) {
    throw new AccessError('Not Found', 404)
  }

  await assertStudyMembership({ access, orgId: org.id, studyId: study.id, userId, denial: 'Not Found' })

  return { userId, orgId: org.id, study, subject, role, access }
}
