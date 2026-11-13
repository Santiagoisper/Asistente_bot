import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Acceso por estudio, paso 2b (docs/decisions/study-membership.md): los
 * validadores deciden por rol en modo `open` y por funciones en modo estricto.
 * Cada rechazo se comprueba por su causa (estado y mensaje), no solo porque
 * «falla».
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveOrg: vi.fn(),
  organizationsFindFirst: vi.fn(),
  subjectsFindFirst: vi.fn(),
  studiesFindFirst: vi.fn(),
  functionRows: vi.fn(),
  membershipRows: vi.fn(),
  membershipWhere: vi.fn(),
  conversationsFindFirst: vi.fn(),
  documentsFindFirst: vi.fn(),
  versionsFindFirst: vi.fn(),
  messagesFindFirst: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth, clerkClient: vi.fn() }))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  isNull: vi.fn((column: unknown) => ({ isNull: column })),
  gt: vi.fn((left: unknown, right: unknown) => ({ gt: left, than: right })),
  or: vi.fn((...alternatives: unknown[]) => ({ alternatives })),
}))

vi.mock('@ichtys/db', () => ({
  db: {
    query: {
      organizations: { findFirst: mocks.organizationsFindFirst },
      subjects: { findFirst: mocks.subjectsFindFirst },
      studies: { findFirst: mocks.studiesFindFirst },
      conversations: { findFirst: mocks.conversationsFindFirst },
      documents: { findFirst: mocks.documentsFindFirst },
      documentVersions: { findFirst: mocks.versionsFindFirst },
      messages: { findFirst: mocks.messagesFindFirst },
    },
    // Dos consultas distintas pasan por `select`: las funciones (se espera el
    // `where`) y la membresía (encadena `.limit(1)`). Se distinguen por tabla.
    select: vi.fn(() => ({
      from: vi.fn((table: { __table?: string }) =>
        table.__table === 'study_memberships'
          ? {
              where: (condition: unknown) => {
                mocks.membershipWhere(condition)
                return { limit: mocks.membershipRows }
              },
            }
          : { where: mocks.functionRows },
      ),
    })),
  },
  organizations: { clerkOrgId: 'organizations.clerkOrgId' },
  studies: { id: 'studies.id', organizationId: 'studies.organizationId' },
  subjects: { id: 'subjects.id', organizationId: 'subjects.organizationId' },
  conversations: { id: 'conversations.id', organizationId: 'conversations.organizationId', userId: 'conversations.userId' },
  documents: { id: 'documents.id', organizationId: 'documents.organizationId', studyId: 'documents.studyId' },
  documentVersions: {},
  messages: {},
  pages: {},
  memberFunctions: {
    functionKey: 'member_functions.function_key',
    organizationId: 'member_functions.organization_id',
    userId: 'member_functions.user_id',
    revokedAt: 'member_functions.revoked_at',
  },
  studyMemberships: {
    __table: 'study_memberships',
    id: 'study_memberships.id',
    organizationId: 'study_memberships.organization_id',
    studyId: 'study_memberships.study_id',
    userId: 'study_memberships.user_id',
    revokedAt: 'study_memberships.revoked_at',
    expiresAt: 'study_memberships.expires_at',
  },
}))

vi.mock('../resolve-org', () => ({ resolveOrProvisionOrganization: mocks.resolveOrg }))

import { loadAccessSubject } from '../access-subject'
import type { AccessSubject } from '../functions'
import {
  validateConversationAccess,
  validateDocumentAccess,
  validateDocumentPageAccess,
  validateDocumentVersionAccess,
  validateMessageAccess,
} from '../object-access'
import { validatePhiStudyAccess, validateSubjectAccess } from '../phi-access'
import { canEnterStudy } from '../study-membership'
import { validateStudyAccess } from '../validate-study-access'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const STUDY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SUBJECT_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = 'user_ficticio'

function signIn(orgRole: string): void {
  mocks.auth.mockResolvedValue({ userId: USER_ID, orgId: 'org_clerk_ficticia', orgRole })
}

function organization(accessMode: unknown): void {
  const org = { id: ORG_ID, clerkOrgId: 'org_clerk_ficticia', accessMode }
  mocks.organizationsFindFirst.mockResolvedValue(org)
  mocks.resolveOrg.mockResolvedValue(org)
}

function functions(...keys: string[]): void {
  mocks.functionRows.mockResolvedValue(keys.map((functionKey) => ({ functionKey })))
}

/** La base devuelve (o no) una membresía vigente para la consulta de alcance. */
function membership(present: boolean): void {
  mocks.membershipRows.mockResolvedValue(present ? [{ id: 'membresia-ficticia' }] : [])
}

beforeEach(() => {
  vi.clearAllMocks()
  // Por defecto la persona es miembro del estudio: los bloques de capacidad
  // de más abajo prueban el otro eje. El bloque de alcance lo cambia.
  membership(true)
  mocks.studiesFindFirst.mockResolvedValue({ id: STUDY_ID, organizationId: ORG_ID })
  mocks.subjectsFindFirst.mockResolvedValue({ id: SUBJECT_ID, organizationId: ORG_ID, studyId: STUDY_ID })
  mocks.conversationsFindFirst.mockResolvedValue({ id: 'conv-ficticia', organizationId: ORG_ID, studyId: STUDY_ID })
  mocks.documentsFindFirst.mockResolvedValue({ id: 'doc-ficticio', organizationId: ORG_ID, studyId: STUDY_ID })
  mocks.versionsFindFirst.mockResolvedValue({ id: 'ver-ficticia', organizationId: ORG_ID, studyId: STUDY_ID, documentId: 'doc-ficticio' })
  mocks.messagesFindFirst.mockResolvedValue({ id: 'msg-ficticio', organizationId: ORG_ID, studyId: STUDY_ID })
  functions()
})

describe('loadAccessSubject', () => {
  it('en open no consulta funciones: mismo costo y mismo comportamiento que antes', async () => {
    const subject = await loadAccessSubject({
      org: { id: ORG_ID, accessMode: 'open' },
      userId: USER_ID,
      role: 'site_coordinator',
    })
    expect(subject).toEqual({ mode: 'open', role: 'site_coordinator', functions: [] })
    expect(mocks.functionRows).not.toHaveBeenCalled()
  })

  it('si el modo falta o es desconocido, restringe', async () => {
    for (const accessMode of [undefined, null, '', 'OPEN', 'abierto']) {
      const subject = await loadAccessSubject({
        org: { id: ORG_ID, accessMode },
        userId: USER_ID,
        role: 'site_coordinator',
      })
      expect(subject.mode, String(accessMode)).toBe('enforced')
    }
  })

  it('en enforced lee las funciones vigentes y descarta los nombres desconocidos', async () => {
    functions('investigator', 'investigador', 'lab_assistant')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const subject = await loadAccessSubject({
      org: { id: ORG_ID, accessMode: 'enforced' },
      userId: USER_ID,
      role: 'read_only_monitor',
    })
    expect(subject.functions).toEqual(['investigator', 'lab_assistant'])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('M8: open con plazo vencido se lee como enforced', async () => {
    functions('investigator')
    const subject = await loadAccessSubject({
      org: { id: ORG_ID, accessMode: 'open', accessOpenUntil: new Date(Date.now() - 1000) },
      userId: USER_ID,
      role: 'read_only_monitor',
    })
    expect(subject.mode).toBe('enforced')
    expect(subject.functions).toEqual(['investigator'])
    expect(mocks.functionRows).toHaveBeenCalled()
  })

  it('M8: open con plazo vigente o sin plazo sigue siendo open', async () => {
    for (const accessOpenUntil of [undefined, null, new Date(Date.now() + 60 * 24 * 3600 * 1000)]) {
      const subject = await loadAccessSubject({
        org: { id: ORG_ID, accessMode: 'open', accessOpenUntil },
        userId: USER_ID,
        role: 'site_coordinator',
      })
      expect(subject.mode, String(accessOpenUntil)).toBe('open')
    }
    expect(mocks.functionRows).not.toHaveBeenCalled()
  })

  it('M8: vence al llegar la fecha (inclusive); una fecha que no es Date no vence', async () => {
    const justNow = await loadAccessSubject({
      org: { id: ORG_ID, accessMode: 'open', accessOpenUntil: new Date() },
      userId: USER_ID,
      role: 'site_coordinator',
    })
    expect(justNow.mode).toBe('enforced')

    const notADate = await loadAccessSubject({
      org: { id: ORG_ID, accessMode: 'open', accessOpenUntil: '2026-01-01' },
      userId: USER_ID,
      role: 'site_coordinator',
    })
    expect(notADate.mode).toBe('open')
  })

  it('M14: el administrador de la organización conserva platform_admin, que no trae datos clínicos', async () => {
    const admin = await loadAccessSubject({
      org: { id: ORG_ID, accessMode: 'enforced' },
      userId: USER_ID,
      role: 'org_admin',
    })
    expect(admin.functions).toEqual(['platform_admin'])

    const coordinator = await loadAccessSubject({
      org: { id: ORG_ID, accessMode: 'enforced' },
      userId: USER_ID,
      role: 'study_admin',
    })
    expect(coordinator.functions).toEqual([])
  })
})

describe('autoría clínica en validateSubjectAccess', () => {
  const author = { require: 'clinical.author' } as const

  it('open: quien hoy puede evolucionar sigue pudiendo, tenga o no funciones cargadas', async () => {
    organization('open')
    for (const role of ['org:admin', 'org:study_admin', 'org:site_coordinator', 'org:principal_investigator']) {
      signIn(role)
      const context = await validateSubjectAccess(SUBJECT_ID, STUDY_ID, author)
      expect(context.access.mode, role).toBe('open')
    }
    expect(mocks.functionRows).not.toHaveBeenCalled()
  })

  it('open: el monitor sigue sin acceso a datos clínicos (403 Forbidden)', async () => {
    organization('open')
    signIn('org:read_only_monitor')
    await expect(validateSubjectAccess(SUBJECT_ID, STUDY_ID, author)).rejects.toMatchObject({
      status: 403,
      message: 'Forbidden',
    })
    expect(mocks.subjectsFindFirst).not.toHaveBeenCalled()
  })

  it('enforced: el rol más alto, sin la función Investigador, no puede escribir una evolución', async () => {
    organization('enforced')
    signIn('org:admin')
    functions('operations_director', 'study_coordinator', 'crf_assistant')
    await expect(validateSubjectAccess(SUBJECT_ID, STUDY_ID, author)).rejects.toMatchObject({
      status: 403,
      message: 'Forbidden',
    })
    // Rechazado por la capacidad, antes de leer al sujeto.
    expect(mocks.subjectsFindFirst).not.toHaveBeenCalled()
  })

  it('enforced: esa misma persona sí puede LEER las evoluciones', async () => {
    organization('enforced')
    signIn('org:admin')
    functions('study_coordinator')
    const context = await validateSubjectAccess(SUBJECT_ID, STUDY_ID)
    expect(context.subject.id).toBe(SUBJECT_ID)
  })

  it('enforced: con la función Investigador escribe, aunque su rol histórico sea el más bajo', async () => {
    organization('enforced')
    signIn('org:read_only_monitor')
    functions('investigator')
    const context = await validateSubjectAccess(SUBJECT_ID, STUDY_ID, author)
    expect(context.access.functions).toEqual(['investigator'])
  })

  it('enforced: el monitor no ve datos clínicos; la administración de la plataforma tampoco', async () => {
    organization('enforced')
    signIn('org:admin')
    functions('monitor')
    await expect(validateSubjectAccess(SUBJECT_ID, STUDY_ID)).rejects.toMatchObject({ status: 403 })
    await expect(validatePhiStudyAccess(STUDY_ID)).rejects.toMatchObject({ status: 403 })

    functions('platform_admin')
    await expect(validatePhiStudyAccess(STUDY_ID)).rejects.toMatchObject({ status: 403 })
  })
})

describe('las rutas que modifican nombran su capacidad', () => {
  it('enforced: Dirección de Investigación ve datos clínicos pero no mueve turnos ni da de alta sujetos', async () => {
    organization('enforced')
    signIn('org:admin')
    functions('research_director')

    await expect(validatePhiStudyAccess(STUDY_ID)).resolves.toBeDefined()
    for (const require of ['agenda.manage', 'subjects.manage'] as const) {
      await expect(validatePhiStudyAccess(STUDY_ID, { require }), require).rejects.toMatchObject({
        status: 403,
        message: 'Forbidden',
      })
    }
    // Rechazado por la capacidad: el estudio solo se buscó en la llamada sin requisito.
    expect(mocks.studiesFindFirst).toHaveBeenCalledTimes(1)
  })

  it('enforced: el asistente de regulatorio no carga ni confirma laboratorios; el de laboratorio sí', async () => {
    organization('enforced')
    signIn('org:site_coordinator')

    functions('regulatory_assistant')
    await expect(validateSubjectAccess(SUBJECT_ID, STUDY_ID, { require: 'labs.manage' })).rejects.toMatchObject({
      status: 403,
      message: 'Forbidden',
    })
    expect(mocks.subjectsFindFirst).not.toHaveBeenCalled()

    functions('lab_assistant')
    await expect(validateSubjectAccess(SUBJECT_ID, STUDY_ID, { require: 'labs.manage' })).resolves.toBeDefined()
  })

  it('enforced: cualquier integrante del equipo maneja la agenda', async () => {
    organization('enforced')
    signIn('org:read_only_monitor')
    for (const fn of ['investigator', 'study_coordinator', 'lab_assistant', 'regulatory_assistant', 'crf_assistant']) {
      functions(fn)
      await expect(validatePhiStudyAccess(STUDY_ID, { require: 'agenda.manage' }), fn).resolves.toBeDefined()
    }
  })

  it('open: el requisito no agrega nada; decide el rol, como siempre', async () => {
    organization('open')
    signIn('org:site_coordinator')
    await expect(validatePhiStudyAccess(STUDY_ID, { require: 'agenda.manage' })).resolves.toBeDefined()
    await expect(validateSubjectAccess(SUBJECT_ID, STUDY_ID, { require: 'labs.manage' })).resolves.toBeDefined()

    signIn('org:read_only_monitor')
    await expect(validatePhiStudyAccess(STUDY_ID, { require: 'agenda.manage' })).rejects.toMatchObject({ status: 403 })
    expect(mocks.functionRows).not.toHaveBeenCalled()
  })
})

describe('entrada a un estudio en validateStudyAccess', () => {
  it('open: cualquier miembro de la organización entra, como siempre', async () => {
    organization('open')
    signIn('org:read_only_monitor')
    const context = await validateStudyAccess(STUDY_ID)
    expect(context.study.id).toBe(STUDY_ID)
    expect(context.access).toEqual({ mode: 'open', role: 'read_only_monitor', functions: [] })
  })

  it('enforced: sin funciones, la respuesta es la de un estudio que no existe (404)', async () => {
    organization('enforced')
    signIn('org:study_admin')
    await expect(validateStudyAccess(STUDY_ID)).rejects.toMatchObject({
      status: 404,
      message: 'Study not found or access denied',
    })
  })

  it('enforced: la administración de la plataforma sola no entra a estudios (M12)', async () => {
    organization('enforced')
    signIn('org:admin')
    await expect(validateStudyAccess(STUDY_ID)).rejects.toMatchObject({ status: 404 })
  })

  it('enforced: el monitor entra al estudio', async () => {
    organization('enforced')
    signIn('org:read_only_monitor')
    functions('monitor')
    const context = await validateStudyAccess(STUDY_ID)
    expect(context.access.functions).toEqual(['monitor'])
  })

  it('open: el requisito de rol decide, y la capacidad no cuenta', async () => {
    organization('open')
    signIn('org:site_coordinator')
    await expect(validateStudyAccess(STUDY_ID, 'study_admin', 'documents.manage')).rejects.toMatchObject({
      status: 403,
      message: 'Insufficient role',
    })
    signIn('org:study_admin')
    await expect(validateStudyAccess(STUDY_ID, 'study_admin', 'documents.manage')).resolves.toBeDefined()
  })

  it('enforced: decide la capacidad, y el rol no cuenta', async () => {
    organization('enforced')
    signIn('org:admin')
    functions('lab_assistant')
    await expect(validateStudyAccess(STUDY_ID, 'study_admin', 'documents.manage')).rejects.toMatchObject({
      status: 403,
      message: 'Insufficient role',
    })

    signIn('org:read_only_monitor')
    functions('regulatory_assistant')
    await expect(validateStudyAccess(STUDY_ID, 'study_admin', 'documents.manage')).resolves.toBeDefined()
  })

  it('enforced: una ruta que pide un rol sin nombrar la capacidad queda cerrada', async () => {
    organization('enforced')
    signIn('org:admin')
    functions('operations_director')
    await expect(validateStudyAccess(STUDY_ID, 'study_admin')).rejects.toMatchObject({
      status: 403,
      message: 'Insufficient role',
    })
  })
})

/**
 * Paso 3: ALCANCE. Tener la función no alcanza; hay que ser miembro del
 * estudio. Cada rechazo se compara con el del objeto inexistente, porque la
 * diferencia entre los dos mensajes sería la fuga.
 */
describe('membresía por estudio (alcance)', () => {
  const base = { orgId: ORG_ID, studyId: STUDY_ID, userId: USER_ID }

  it('open: no se consulta la membresía; todos entran como siempre', async () => {
    membership(false)
    const allowed = await canEnterStudy({ ...base, access: { mode: 'open', role: 'read_only_monitor', functions: [] } })
    expect(allowed).toBe(true)
    expect(mocks.membershipRows).not.toHaveBeenCalled()

    organization('open')
    signIn('org:site_coordinator')
    await expect(validateStudyAccess(STUDY_ID)).resolves.toBeDefined()
    await expect(validateSubjectAccess(SUBJECT_ID, STUDY_ID)).resolves.toBeDefined()
    expect(mocks.membershipRows).not.toHaveBeenCalled()
  })

  it('enforced: las dos direcciones entran a todos los estudios sin consultar (M10)', async () => {
    membership(false)
    for (const fn of ['operations_director', 'research_director'] as const) {
      const allowed = await canEnterStudy({ ...base, access: { mode: 'enforced', role: 'read_only_monitor', functions: [fn] } })
      expect(allowed, fn).toBe(true)
    }
    expect(mocks.membershipRows).not.toHaveBeenCalled()
  })

  it('enforced: el resto del equipo necesita una membresía vigente', async () => {
    for (const fn of ['investigator', 'study_coordinator', 'lab_assistant', 'regulatory_assistant', 'crf_assistant', 'monitor'] as const) {
      const access = { mode: 'enforced' as const, role: 'study_admin' as const, functions: [fn] }
      membership(false)
      expect(await canEnterStudy({ ...base, access }), `${fn} sin membresía`).toBe(false)
      membership(true)
      expect(await canEnterStudy({ ...base, access }), `${fn} con membresía`).toBe(true)
    }
  })

  it('la consulta filtra por organización, estudio y persona, y descarta bajas y vencidas', async () => {
    const now = new Date('2026-11-12T12:00:00Z')
    await canEnterStudy({
      ...base,
      now,
      access: { mode: 'enforced', role: 'site_coordinator', functions: ['investigator'] },
    })
    expect(mocks.membershipWhere).toHaveBeenCalledTimes(1)
    expect(mocks.membershipWhere.mock.calls[0]?.[0]).toEqual({
      conditions: [
        { left: 'study_memberships.organization_id', right: ORG_ID },
        { left: 'study_memberships.study_id', right: STUDY_ID },
        { left: 'study_memberships.user_id', right: USER_ID },
        { isNull: 'study_memberships.revoked_at' },
        {
          alternatives: [
            { isNull: 'study_memberships.expires_at' },
            { gt: 'study_memberships.expires_at', than: now },
          ],
        },
      ],
    })
    expect(mocks.membershipRows).toHaveBeenCalledWith(1)
  })

  it('M18: para el monitor la membresía sin fecha ya venció; para el resto sigue sin vencer', async () => {
    const now = new Date('2026-11-12T12:00:00Z')
    const lastMembershipCondition = async (functions: AccessSubject['functions']): Promise<unknown> => {
      await canEnterStudy({ ...base, now, access: { mode: 'enforced', role: 'read_only_monitor', functions } })
      const where = mocks.membershipWhere.mock.calls.at(-1)?.[0] as { conditions: unknown[] }
      return where.conditions.at(-1)
    }

    // El resto del equipo: sin fecha o fecha futura («sin fecha» = no vence).
    expect(await lastMembershipCondition(['investigator'])).toEqual({
      alternatives: [
        { isNull: 'study_memberships.expires_at' },
        { gt: 'study_memberships.expires_at', than: now },
      ],
    })
    // El monitor: solo fecha futura. La membresía sin fecha — creada antes de
    // recibir la función, o heredada de antes de M18 — no vale.
    expect(await lastMembershipCondition(['monitor'])).toEqual({ gt: 'study_memberships.expires_at', than: now })
    // Tener el monitor entre otras funciones mantiene el criterio del monitor.
    expect(await lastMembershipCondition(['investigator', 'monitor'])).toEqual({
      gt: 'study_memberships.expires_at',
      than: now,
    })
  })

  it('validateStudyAccess: con función y sin membresía, la respuesta es la del estudio que no existe', async () => {
    organization('enforced')
    signIn('org:study_admin')
    functions('study_coordinator')
    membership(false)
    await expect(validateStudyAccess(STUDY_ID)).rejects.toMatchObject({
      status: 404,
      message: 'Study not found or access denied',
    })
    // La membresía se decide antes que la capacidad: quien no es miembro no
    // llega a saber si le faltaba además un permiso.
    await expect(validateStudyAccess(STUDY_ID, 'study_admin', 'documents.manage')).rejects.toMatchObject({
      status: 404,
      message: 'Study not found or access denied',
    })

    membership(true)
    await expect(validateStudyAccess(STUDY_ID, 'study_admin', 'documents.manage')).resolves.toBeDefined()
  })

  it('validatePhiStudyAccess: el investigador de otro estudio no ve los sujetos de este', async () => {
    organization('enforced')
    signIn('org:site_coordinator')
    functions('investigator')
    membership(false)
    await expect(validatePhiStudyAccess(STUDY_ID)).rejects.toMatchObject({
      status: 404,
      message: 'Study not found or access denied',
    })
    membership(true)
    await expect(validatePhiStudyAccess(STUDY_ID)).resolves.toBeDefined()
  })

  it('validateSubjectAccess: sin membresía responde igual que un sujeto que no existe', async () => {
    organization('enforced')
    signIn('org:site_coordinator')
    functions('investigator')

    mocks.subjectsFindFirst.mockResolvedValueOnce(undefined)
    const missing = await validateSubjectAccess(SUBJECT_ID, STUDY_ID).catch((error: unknown) => error)

    membership(false)
    const notMember = await validateSubjectAccess(SUBJECT_ID, STUDY_ID, { require: 'clinical.author' }).catch(
      (error: unknown) => error,
    )

    expect(missing).toMatchObject({ status: 404, message: 'Not Found' })
    expect(notMember).toMatchObject({ status: 404, message: 'Not Found' })
  })

  it('documentos y conversaciones: sin membresía, la respuesta es la del objeto que no existe', async () => {
    organization('enforced')
    signIn('org:site_coordinator')
    functions('regulatory_assistant')

    mocks.documentsFindFirst.mockResolvedValueOnce(undefined)
    const missingDocument = await validateDocumentAccess('doc-ficticio').catch((error: unknown) => error)
    mocks.conversationsFindFirst.mockResolvedValueOnce(undefined)
    const missingConversation = await validateConversationAccess('conv-ficticia').catch((error: unknown) => error)

    membership(false)
    const foreignDocument = await validateDocumentAccess('doc-ficticio').catch((error: unknown) => error)
    const foreignConversation = await validateConversationAccess('conv-ficticia').catch((error: unknown) => error)

    expect(missingDocument).toMatchObject({ status: 404, message: 'Document not found or access denied' })
    expect(foreignDocument).toMatchObject({ status: 404, message: 'Document not found or access denied' })
    expect(missingConversation).toMatchObject({ status: 404, message: 'Conversation not found or access denied' })
    expect(foreignConversation).toMatchObject({ status: 404, message: 'Conversation not found or access denied' })

    membership(true)
    await expect(validateDocumentAccess('doc-ficticio')).resolves.toMatchObject({ studyId: STUDY_ID })
  })

  it('Dirección de Investigación lee los datos clínicos de cualquier estudio sin membresía', async () => {
    organization('enforced')
    signIn('org:read_only_monitor')
    functions('research_director')
    membership(false)
    await expect(validateSubjectAccess(SUBJECT_ID, STUDY_ID)).resolves.toBeDefined()
    expect(mocks.membershipRows).not.toHaveBeenCalled()
  })

  // Los tres validadores que solo cubría el tripwire estático (nota de Reviewer en #113).
  it('versión de documento: sin membresía responde igual que una versión que no existe', async () => {
    organization('enforced')
    signIn('org:site_coordinator')
    functions('regulatory_assistant')

    mocks.versionsFindFirst.mockResolvedValueOnce(undefined)
    const missing = await validateDocumentVersionAccess('ver-ficticia').catch((error: unknown) => error)
    membership(false)
    const foreign = await validateDocumentVersionAccess('ver-ficticia').catch((error: unknown) => error)

    expect(missing).toMatchObject({ status: 404, message: 'Document version not found or access denied' })
    expect(foreign).toMatchObject({ status: 404, message: 'Document version not found or access denied' })

    membership(true)
    await expect(validateDocumentVersionAccess('ver-ficticia')).resolves.toMatchObject({ studyId: STUDY_ID })
  })

  it('mensaje: sin membresía responde igual que un mensaje que no existe', async () => {
    organization('enforced')
    signIn('org:site_coordinator')
    functions('investigator')

    mocks.messagesFindFirst.mockResolvedValueOnce(undefined)
    const missing = await validateMessageAccess('msg-ficticio').catch((error: unknown) => error)
    membership(false)
    const foreign = await validateMessageAccess('msg-ficticio').catch((error: unknown) => error)

    expect(missing).toMatchObject({ status: 404, message: 'Message not found or access denied' })
    expect(foreign).toMatchObject({ status: 404, message: 'Message not found or access denied' })

    membership(true)
    await expect(validateMessageAccess('msg-ficticio')).resolves.toMatchObject({ studyId: STUDY_ID })
  })

  it('página de documento: sin membresía responde igual que un documento que no existe, y no llega a buscar la página', async () => {
    organization('enforced')
    signIn('org:site_coordinator')
    functions('regulatory_assistant')

    mocks.documentsFindFirst.mockResolvedValueOnce(undefined)
    const missing = await validateDocumentPageAccess('doc-ficticio', 1).catch((error: unknown) => error)
    membership(false)
    mocks.versionsFindFirst.mockClear()
    const foreign = await validateDocumentPageAccess('doc-ficticio', 1).catch((error: unknown) => error)

    expect(missing).toMatchObject({ status: 404, message: 'Document not found or access denied' })
    expect(foreign).toMatchObject({ status: 404, message: 'Document not found or access denied' })
    expect(mocks.versionsFindFirst).not.toHaveBeenCalled()
  })
})
