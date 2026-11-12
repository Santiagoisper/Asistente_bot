/**
 * Editar el borrador de un protocolo cambia los criterios contra los que se
 * evalúa la elegibilidad. Regla R3: el cambio y su registro van en la misma
 * transacción, y un protocolo que dejó de ser borrador no se puede pisar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 403 | 404,
    ) {
      super(message)
      this.name = 'AccessError'
    }
  }
  return {
    AccessError: MockAccessError,
    validateStudyAccess: vi.fn(),
    findFirst: vi.fn(),
    writes: [] as Array<{ table: string; via: 'tx' | 'db'; values?: Record<string, unknown>; where?: unknown[] }>,
    updatedRows: [{ id: 'spec' }] as Array<{ id: string }>,
    failAudit: false,
    transactions: 0,
  }
})

vi.mock('@ichtys/auth', () => ({ validateStudyAccess: mocks.validateStudyAccess, AccessError: mocks.AccessError }))
vi.mock('@ichtys/db', () => {
  const make = (via: 'tx' | 'db') => ({
    update: (table: { __name: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: (where: unknown[]) => {
          mocks.writes.push({ table: table.__name, via, values, where })
          const done = Promise.resolve(mocks.updatedRows)
          return Object.assign(done, { returning: () => done })
        },
      }),
    }),
    insert: (table: { __name: string }) => ({
      values: (values: Record<string, unknown>) => {
        if (mocks.failAudit) return Promise.reject(new Error('audit unavailable'))
        mocks.writes.push({ table: table.__name, via, values })
        return Promise.resolve()
      },
    }),
  })
  return {
    and: (...parts: unknown[]) => parts,
    eq: (col: unknown, val: unknown) => [col, val],
    studySpecs: { __name: 'study_specs', id: 'id', organizationId: 'organization_id', studyId: 'study_id', status: 'status' },
    auditLogs: { __name: 'audit_logs' },
    db: {
      query: { studySpecs: { findFirst: mocks.findFirst } },
      ...make('db'),
      transaction: async <T,>(run: (tx: unknown) => Promise<T>) => {
        mocks.transactions += 1
        return run(make('tx'))
      },
    },
  }
})

import { PATCH } from '../route'

const STUDY_ID = crypto.randomUUID()
const SPEC_ID = crypto.randomUUID()
const criterion = (number: string, text: string) => ({ number, text, sourcePages: [12], confidence: 'high' })
const body = {
  spec: {
    identification: { protocolCode: null, title: null, phase: null, sourcePages: [] },
    inclusionCriteria: [criterion('1', 'Criterio inventado uno'), criterion('2', 'Criterio inventado dos')],
    exclusionCriteria: [criterion('1', 'Exclusión inventada')],
    endpoints: [],
    visits: [],
  },
}
const patch = () =>
  PATCH(new Request(`http://localhost/api/studies/${STUDY_ID}/spec/${SPEC_ID}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: STUDY_ID, specId: SPEC_ID }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.writes.length = 0
  mocks.updatedRows = [{ id: SPEC_ID }]
  mocks.failAudit = false
  mocks.transactions = 0
  mocks.validateStudyAccess.mockResolvedValue({ orgId: 'org-1', userId: 'user-1' })
  mocks.findFirst.mockResolvedValue({ id: SPEC_ID, status: 'draft', version: 3, organizationId: 'org-1', studyId: STUDY_ID })
})

describe('PATCH spec/[specId] — editar un borrador deja registro', () => {
  it('el cambio y su registro entran por la misma transacción; el registro lleva cuentas, no el texto', async () => {
    const res = await patch()

    expect(res.status).toBe(200)
    expect(mocks.transactions).toBe(1)
    expect(mocks.writes.map((w) => `${w.via}:${w.table}`)).toEqual(['tx:study_specs', 'tx:audit_logs'])
    expect(mocks.writes[1]!.values).toMatchObject({
      action: 'study_spec.draft.update',
      organizationId: 'org-1',
      studyId: STUDY_ID,
      userId: 'user-1',
      resourceType: 'study_spec',
      resourceId: SPEC_ID,
      metadata: { version: 3, inclusionCriteria: 2, exclusionCriteria: 1, endpoints: 0, visits: 0 },
    })
    expect(JSON.stringify(mocks.writes[1]!.values)).not.toContain('inventad')
  })

  it('la escritura exige que siga siendo borrador: si se aprobó en el medio, no se pisa ni se registra', async () => {
    mocks.updatedRows = []
    const res = await patch()

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Only draft specs can be edited' })
    // La condición de la escritura incluye el estado, no solo la lectura previa.
    expect(JSON.stringify(mocks.writes[0]!.where)).toContain('"status","draft"')
    expect(mocks.writes.map((w) => w.table)).toEqual(['study_specs'])
  })

  it('si el registro no se puede escribir, la edición falla', async () => {
    mocks.failAudit = true
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect((await patch()).status).toBe(500)
    } finally {
      spy.mockRestore()
    }
  })
})
