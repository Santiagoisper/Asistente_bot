import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La evaluación de elegibilidad guarda una instantánea dentro de una lectura.
 * Dos reglas (R3, brecha C1):
 * - si guarda una instantánea, la guarda junto con su registro de auditoría;
 * - no guarda una instantánea igual a la anterior solo porque el perfil cambió
 *   de versión (por ejemplo, al sumar una propuesta sin aceptar).
 */
const mocks = vi.hoisted(() => ({
  assess: vi.fn(),
  profileRow: vi.fn(),
  lastSnapshot: vi.fn(),
  docVersion: vi.fn(),
  inserts: [] as Array<{ table: string; values: unknown; via: 'tx' | 'db' }>,
  transactions: 0,
  writeAuditLog: vi.fn(),
}))

vi.mock('@ichtys/clinical', () => ({
  assessScreening: mocks.assess,
  criterionAssessmentSchema: { parse: (value: unknown) => value },
  screeningSummary: (items: Array<{ status: string }>) => ({
    pass: items.filter((i) => i.status === 'pass').length,
    fail: items.filter((i) => i.status === 'fail').length,
    unknown: items.filter((i) => i.status === 'unknown').length,
  }),
}))

vi.mock('@ichtys/db', () => {
  const insert = (via: 'tx' | 'db') => (table: { __name: string }) => ({
    values: (values: unknown) => {
      mocks.inserts.push({ table: table.__name, values, via })
      const done = Promise.resolve([{ id: 'snapshot-new' }])
      return Object.assign(done, { returning: () => done })
    },
  })
  return {
    and: (...parts: unknown[]) => parts,
    eq: (a: unknown, b: unknown) => [a, b],
    desc: (a: unknown) => a,
    patientProfiles: { __name: 'patient_profiles' },
    screeningAssessments: { __name: 'screening_assessments' },
    documentVersions: { __name: 'document_versions' },
    auditLogs: { __name: 'audit_logs' },
    db: {
      query: {
        patientProfiles: { findFirst: mocks.profileRow },
        screeningAssessments: { findFirst: mocks.lastSnapshot },
        documentVersions: { findFirst: mocks.docVersion },
      },
      insert: insert('db'),
      transaction: async <T,>(run: (tx: unknown) => Promise<T>) => {
        mocks.transactions += 1
        return run({ insert: insert('tx') })
      },
    },
  }
})
vi.mock('../../chat/persistence', () => ({ writeAuditLog: mocks.writeAuditLog }))

import { evaluateAndPersistScreening } from '../screening-service'

const T0 = new Date('2026-11-12T12:00:00.000Z')
const T1 = new Date('2026-11-12T13:00:00.000Z')
const PASS = { criterionNumber: '3', criterionText: 'HbA1c 7,0–10,0 %', kind: 'inclusion', status: 'pass', reason: 'Dentro del rango.', sourcePages: [12] }
const FAIL = { ...PASS, status: 'fail', reason: 'Fuera del rango.' }
/** Como lo devuelve una columna JSONB: mismas claves, otro orden. */
const PASS_REORDERED = { status: 'pass', sourcePages: [12], reason: 'Dentro del rango.', kind: 'inclusion', criterionText: 'HbA1c 7,0–10,0 %', criterionNumber: '3' }

const call = () =>
  evaluateAndPersistScreening({
    orgId: 'org-1',
    studyId: 'study-1',
    subjectId: 'subject-1',
    profile: { version: 1, labs: [], medications: [], conditions: [] } as never,
    spec: { inclusionCriteria: [], exclusionCriteria: [] } as never,
    specVersion: 2,
    documentVersionId: 'docv-1',
    audit: (facts) => ({
      action: 'screening.view',
      orgId: 'org-1',
      studyId: 'study-1',
      userId: 'user-1',
      resourceType: 'subject',
      resourceId: 'subject-1',
      metadata: { ...facts.summary, snapshotId: facts.snapshotId, snapshotCreated: facts.snapshotCreated },
    }),
  })

const snapshotInserts = () => mocks.inserts.filter((i) => i.table === 'screening_assessments')
const auditInserts = () => mocks.inserts.filter((i) => i.table === 'audit_logs')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.inserts.length = 0
  mocks.transactions = 0
  mocks.assess.mockReturnValue([PASS])
  mocks.profileRow.mockResolvedValue({ updatedAt: T1 })
  mocks.docVersion.mockResolvedValue({ documentId: 'doc-1' })
})

describe('evaluateAndPersistScreening — instantánea y registro', () => {
  it('sin instantánea previa: la guarda con su registro en una sola transacción', async () => {
    mocks.lastSnapshot.mockResolvedValue(undefined)
    const result = await call()

    expect(mocks.transactions).toBe(1)
    expect(snapshotInserts()).toEqual([expect.objectContaining({ via: 'tx' })])
    expect(auditInserts()).toEqual([
      expect.objectContaining({ via: 'tx', values: expect.objectContaining({ action: 'screening.view', metadata: expect.objectContaining({ snapshotId: 'snapshot-new', snapshotCreated: true }) }) }),
    ])
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
    expect(result.persistedSnapshotId).toBe('snapshot-new')
  })

  it('el perfil cambió de versión pero la evaluación es idéntica: no guarda otra instantánea', async () => {
    mocks.lastSnapshot.mockResolvedValue({ id: 'snapshot-old', studySpecVersion: 2, profileUpdatedAt: T0, assessments: [PASS_REORDERED] })
    const result = await call()

    expect(mocks.transactions).toBe(0)
    expect(mocks.inserts).toEqual([])
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1)
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ snapshotId: 'snapshot-old', snapshotCreated: false }) }))
    expect(result.persistedSnapshotId).toBe('snapshot-old')
  })

  it('el perfil cambió y la evaluación también: guarda la nueva con su registro', async () => {
    mocks.lastSnapshot.mockResolvedValue({ id: 'snapshot-old', studySpecVersion: 2, profileUpdatedAt: T0, assessments: [FAIL] })
    await call()

    expect(mocks.transactions).toBe(1)
    expect(snapshotInserts()).toHaveLength(1)
    expect(auditInserts()).toHaveLength(1)
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })

  it('cambió la versión del protocolo: guarda aunque el resultado sea el mismo', async () => {
    mocks.lastSnapshot.mockResolvedValue({ id: 'snapshot-old', studySpecVersion: 1, profileUpdatedAt: T1, assessments: [PASS] })
    await call()

    expect(snapshotInserts()).toHaveLength(1)
    expect(auditInserts()).toHaveLength(1)
  })

  it('nada cambió: no escribe ninguna instantánea y registra la consulta una sola vez', async () => {
    mocks.lastSnapshot.mockResolvedValue({ id: 'snapshot-old', studySpecVersion: 2, profileUpdatedAt: T1, assessments: [PASS] })
    await call()

    expect(mocks.inserts).toEqual([])
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1)
  })
})
