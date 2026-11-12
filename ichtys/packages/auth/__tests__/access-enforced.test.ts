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
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth, clerkClient: vi.fn() }))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  isNull: vi.fn((column: unknown) => ({ isNull: column })),
}))

vi.mock('@ichtys/db', () => ({
  db: {
    query: {
      organizations: { findFirst: mocks.organizationsFindFirst },
      subjects: { findFirst: mocks.subjectsFindFirst },
      studies: { findFirst: mocks.studiesFindFirst },
    },
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: mocks.functionRows })) })),
  },
  organizations: { clerkOrgId: 'organizations.clerkOrgId' },
  studies: { id: 'studies.id', organizationId: 'studies.organizationId' },
  subjects: { id: 'subjects.id', organizationId: 'subjects.organizationId' },
  memberFunctions: {
    functionKey: 'member_functions.function_key',
    organizationId: 'member_functions.organization_id',
    userId: 'member_functions.user_id',
    revokedAt: 'member_functions.revoked_at',
  },
}))

vi.mock('../resolve-org', () => ({ resolveOrProvisionOrganization: mocks.resolveOrg }))

import { loadAccessSubject } from '../access-subject'
import { validatePhiStudyAccess, validateSubjectAccess } from '../phi-access'
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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.studiesFindFirst.mockResolvedValue({ id: STUDY_ID, organizationId: ORG_ID })
  mocks.subjectsFindFirst.mockResolvedValue({ id: SUBJECT_ID, organizationId: ORG_ID, studyId: STUDY_ID })
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
