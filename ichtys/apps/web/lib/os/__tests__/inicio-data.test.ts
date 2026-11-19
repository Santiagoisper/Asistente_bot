import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Datos del Inicio (auditoría 19/11, H-09). El filtro por organización y alcance ya lo vigila
 * tests/leakage; acá se prueba lo que arma el archivo con las filas: etiquetas de estudio,
 * enlaces, la regla de no mostrar códigos de sujeto a quien no puede verlos y los conteos.
 */
const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  calls: [] as Array<{ table: string; where: unknown }>,
}))

vi.mock('@ichtys/db', () => {
  const table = (name: string) =>
    new Proxy({ __table: name }, { get: (_t, k) => (k === '__table' ? name : `${name}.${String(k)}`) })
  const query = () => {
    const state = { table: '', where: undefined as unknown }
    const done = () => {
      mocks.calls.push({ table: state.table, where: state.where })
      return Promise.resolve(mocks.rows[state.table] ?? [])
    }
    const chain: Record<string, unknown> = {
      from: (t: { __table: string }) => ((state.table = t.__table), chain),
      innerJoin: () => chain,
      where: (w: unknown) => ((state.where = w), chain),
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => done(),
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => done().then(ok, ko),
    }
    return chain
  }
  return {
    db: { select: () => query() },
    auditLogs: table('audit_logs'),
    documents: table('documents'),
    documentVersions: table('document_versions'),
    labReports: table('lab_reports'),
    patientProfiles: table('patient_profiles'),
    studies: table('studies'),
    studySpecs: table('study_specs'),
    subjects: table('subjects'),
    and: (...xs: unknown[]) => ({ and: xs }),
    eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
    inArray: (c: unknown, v: unknown) => ({ in: [c, v] }),
    count: () => 'count(*)',
    desc: (c: unknown) => c,
    sql: (s: TemplateStringsArray) => ({ sql: s.join('?') }),
  }
})
vi.mock('@ichtys/auth/study-scope', () => ({ studyScopeFilter: () => ({ scope: true }) }))

import { countNativePriority, labOutcomes30d, listPendingLabReviews, listPriorityItems } from '../inicio-data'

const scope = { mode: 'all' } as never
const at = new Date('2026-11-18T10:00:00Z')

beforeEach(() => {
  mocks.rows = {}
  mocks.calls = []
})

describe('listPriorityItems', () => {
  beforeEach(() => {
    mocks.rows = {
      patient_profiles: [{ subjectId: 's1', subjectCode: 'S-001', studyId: 'e1', studyName: 'Estudio Uno', protocolNumber: ' P-100 ', since: at }],
      lab_reports: [{ reportId: 'r1', subjectId: 's2', subjectCode: 'S-002', studyId: 'e1', studyName: 'Estudio Uno', protocolNumber: null, rowCount: 3, since: at }],
      document_versions: [{ versionId: 'v1', documentName: 'Protocolo.pdf', studyId: 'e2', studyName: 'Estudio Dos', protocolNumber: '', createdAt: at }],
      study_specs: [{ specId: 'sp1', studyId: 'e2', studyName: 'Estudio Dos', protocolNumber: null, version: 4, createdAt: at }],
    }
  })

  it('arma cada ítem con su enlace y usa el número de protocolo como etiqueta (o el nombre si falta)', async () => {
    const items = await listPriorityItems('org-a', scope, { includeSubjects: true })
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(byId['lab:s1']).toMatchObject({ detail: 'S-001 · P-100', href: '/studies/e1/subjects/s1', severity: 'high' })
    expect(byId['lab-report:r1']).toMatchObject({ detail: 'S-002 · Estudio Uno', href: '/studies/e1/subjects/s2/labs/r1' })
    expect(byId['ingestion:v1']).toMatchObject({ detail: 'Protocolo.pdf · Estudio Dos', href: '/studies/e2/documents' })
    expect(byId['spec:sp1']).toMatchObject({ detail: 'Estudio Dos · versión 4', severity: 'medium' })
  })

  it('sin permiso para ver sujetos no consulta ni muestra códigos de sujeto', async () => {
    const items = await listPriorityItems('org-a', scope, { includeSubjects: false })
    expect(items.map((i) => i.kind)).not.toContain('lab')
    expect(JSON.stringify(items)).not.toMatch(/S-00/)
    expect(mocks.calls.map((c) => c.table)).not.toContain('patient_profiles')
    expect(mocks.calls.map((c) => c.table)).not.toContain('lab_reports')
  })

  it('suma avisos del sistema y de satélites con id propio por módulo', async () => {
    const items = await listPriorityItems('org-a', scope, {
      includeSubjects: false,
      system: [{ id: 'sys:retention', kind: 'system', severity: 'high', title: 'Borrado detenido', detail: '', href: '/ajustes', since: null } as never],
      satellites: [{ module: 'agenda', alerts: [{ id: 'x', severity: 'low', title: 'Visita', detail: 'd', href: '/agenda' } as never] }],
    })
    const ids = items.map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining(['sys:retention', 'agenda:x']))
  })

  it('un laboratorio sin fecha de inicio no rompe el armado', async () => {
    mocks.rows.patient_profiles = [{ subjectId: 's9', subjectCode: 'S-009', studyId: 'e1', studyName: 'E', protocolNumber: null, since: null }]
    const items = await listPriorityItems('org-a', scope, { includeSubjects: true })
    expect(items.find((i) => i.id === 'lab:s9')?.since).toBeNull()
  })
})

describe('conteos', () => {
  it('labOutcomes30d separa confirmaciones y rechazos y da cero si no hay', async () => {
    mocks.rows.audit_logs = [{ action: 'lab.confirm', value: 7 }]
    expect(await labOutcomes30d('org-a', scope, at)).toEqual({ confirmed: 7, rejected: 0 })
    const where = JSON.stringify(mocks.calls[0]!.where)
    expect(where).toContain('audit_logs.organizationId')
    expect(where).toContain('lab.reject')
  })

  it('countNativePriority suma laboratorio, ingestas fallidas y specs, y omite laboratorio sin permiso', async () => {
    mocks.rows = { patient_profiles: [{ value: 2 }], lab_reports: [{ value: 1 }], document_versions: [{ value: 3 }], study_specs: [{ value: 4 }] }
    expect(await countNativePriority('org-a', scope, true)).toBe(10)
    expect(await countNativePriority('org-a', scope, false)).toBe(7)
  })

  it('cada consulta filtra por la organización pedida', async () => {
    mocks.rows.patient_profiles = []
    await listPendingLabReviews('org-z', scope, 5)
    expect(JSON.stringify(mocks.calls[0]!.where)).toContain('"org-z"')
  })
})
