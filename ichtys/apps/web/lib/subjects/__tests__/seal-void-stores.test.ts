import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Los dos «stores» que escriben datos clínicos (auditoría 19/11, H-09): el sellado del
 * screening y la anulación de evoluciones. Se prueba que toda escritura quede dentro de la
 * organización de quien llama, que el registro de auditoría vaya en la misma transacción y
 * que la nota de anulación nunca se guarde en claro.
 */
const m = vi.hoisted(() => ({
  log: [] as Array<{ op: string; table?: string; set?: unknown; values?: unknown; where?: unknown }>,
  selectRows: [] as unknown[],
  returning: [] as unknown[],
  audit: vi.fn(async () => undefined),
  lock: vi.fn(async () => true),
  find: vi.fn(async () => ({ id: 'ev1' })),
}))

vi.mock('@ichtys/db', () => {
  const table = (name: string) => new Proxy({ __t: name }, { get: (_t, k) => (k === '__t' ? name : `${name}.${String(k)}`) })
  const chain = (entry: (typeof m.log)[number], rows: () => unknown[]) => {
    const c: Record<string, unknown> = {}
    const done = () => (m.log.push(entry), Promise.resolve(rows()))
    for (const k of ['innerJoin', 'orderBy', 'groupBy', 'limit', 'onConflictDoNothing']) c[k] = () => c
    c.from = (t: { __t: string }) => ((entry.table = t.__t), c)
    c.where = (w: unknown) => ((entry.where = w), c)
    c.set = (s: unknown) => ((entry.set = s), c)
    c.values = (v: unknown) => ((entry.values = v), c)
    c.for = () => done()
    c.returning = () => done().then(() => m.returning)
    c.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => done().then(ok, ko)
    return c
  }
  const tx = {
    select: () => chain({ op: 'select' }, () => m.selectRows),
    update: (t: { __t: string }) => chain({ op: 'update', table: t.__t }, () => []),
    insert: (t: { __t: string }) => chain({ op: 'insert', table: t.__t }, () => []),
  }
  return {
    db: { ...tx, transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
    screeningAssessments: table('screening_assessments'),
    patientProfiles: table('patient_profiles'),
    evolutionVoids: table('evolution_voids'),
    dictationAudios: table('dictation_audios'),
    unassignedDictationAudios: table('unassigned_dictation_audios'),
    and: (...xs: unknown[]) => ({ and: xs }),
    eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
    isNull: (c: unknown) => ({ isNull: c }),
    asc: (c: unknown) => c,
    count: () => 'count(*)',
    sql: (s: TemplateStringsArray) => ({ sql: s.join('?') }),
  }
})
vi.mock('../../audit/audited-write', () => ({ insertAuditLog: m.audit }))
vi.mock('../evolution-reader', () => ({ lockSubjectEvolution: m.lock, findSubjectEvolution: m.find }))
vi.mock('../phi-fields', () => ({ encryptClinicalContent: (t: string) => ({ enc: 'phi.v1', ciphertext: `cifrado(${t.length})` }) }))

import { orgSealStore } from '../screening-seal-store'
import { txVoidStore } from '../evolution-void-store'

beforeEach(() => {
  m.log = []
  m.selectRows = []
  m.returning = []
  vi.clearAllMocks()
  m.lock.mockResolvedValue(true)
})

const has = (where: unknown, text: string) => JSON.stringify(where).includes(text)

describe('orgSealStore.sealBatch', () => {
  const audit = (n: number) => ({ action: 'screening.seal', metadata: { n } }) as never

  it('escribe solo las filas con algo que sellar, cada una acotada a la organización, y audita en la misma transacción', async () => {
    m.selectRows = [
      { id: 'a1', organizationId: 'org-a', assessments: [], summary: 'x' },
      { id: 'a2', organizationId: 'org-a', assessments: {}, summary: {} },
    ]
    const plan = (row: { id: string }) => ({ set: row.id === 'a1' ? { assessments: { enc: 'phi.v1' } } : {} })
    expect(await orgSealStore('org-a').sealBatch(10, plan as never, audit)).toBe(1)
    const updates = m.log.filter((e) => e.op === 'update')
    expect(updates).toHaveLength(1)
    expect(has(updates[0]!.where, '"a1"') && has(updates[0]!.where, '"org-a"')).toBe(true)
    expect(has(m.log[0]!.where, '"org-a"')).toBe(true)
    expect(m.audit).toHaveBeenCalledWith(expect.anything(), { action: 'screening.seal', metadata: { n: 1 } })
  })

  it('sin filas que escribir no deja registro de auditoría', async () => {
    m.selectRows = []
    expect(await orgSealStore('org-a').sealBatch(10, (() => ({ set: {} })) as never, audit)).toBe(0)
    expect(m.audit).not.toHaveBeenCalled()
  })

  it('si el plan de una fila falla, la tanda se corta antes de auditar', async () => {
    m.selectRows = [{ id: 'a1' }]
    const plan = () => {
      throw new Error('round_trip_mismatch')
    }
    await expect(orgSealStore('org-a').sealBatch(10, plan as never, audit)).rejects.toThrow('round_trip_mismatch')
    expect(m.audit).not.toHaveBeenCalled()
  })

  it('los conteos y las muestras de clave filtran por la organización', async () => {
    m.selectRows = [{ n: 3 }]
    expect(await orgSealStore('org-b').countRows()).toBe(3)
    m.selectRows = [{ payload: 'c1' }]
    expect(await orgSealStore('org-b').keySamples()).toEqual(['c1', 'c1'])
    for (const e of m.log) expect(has(e.where, '"org-b"')).toBe(true)
  })
})

describe('txVoidStore', () => {
  const scope = { orgId: 'org-a', studyId: 'st-1', subjectId: 'su-1', evolutionId: 'ev1' }
  const store = () => txVoidStore({} as never, scope as never)
  // `txVoidStore` usa la transacción que recibe; acá se le pasa la del mock.
  const real = async () => {
    const { db } = await import('@ichtys/db')
    return txVoidStore(db as never, scope as never)
  }

  it('si no consigue el bloqueo, no busca la evolución', async () => {
    m.lock.mockResolvedValue(false)
    expect(await store().findEvolution()).toBeNull()
    expect(m.find).not.toHaveBeenCalled()
  })

  it('la nota de la anulación se guarda cifrada, y el registro lleva organización, estudio y sujeto de quien llama', async () => {
    m.returning = [{ id: 'v1' }]
    const s = await real()
    expect(await s.insertVoid({ evolutionId: 'ev1', reason: 'error', note: 'texto clínico privado', declaredBy: 'u1', declaredAt: new Date() } as never)).toBe('v1')
    const values = m.log.find((e) => e.op === 'insert')!.values as Record<string, unknown>
    expect(values).toMatchObject({ organizationId: 'org-a', studyId: 'st-1', subjectId: 'su-1' })
    expect(JSON.stringify(values)).not.toContain('texto clínico privado')
  })

  it('una anulación repetida devuelve null (no duplica)', async () => {
    m.returning = []
    const s = await real()
    expect(await s.insertVoid({ evolutionId: 'ev1', reason: 'error', note: null, declaredBy: 'u1', declaredAt: new Date() } as never)).toBeNull()
  })

  it('retirar un audio borra su contenido y solo vale dentro de la organización', async () => {
    m.returning = [{ id: 'au1' }]
    const s = await real()
    expect(await s.withdrawAudio('au1', new Date())).toBe(true)
    const upd = m.log.find((e) => e.op === 'update')!
    expect(upd.set).toMatchObject({ contentEncrypted: null, segmentsEncrypted: null })
    expect(has(upd.where, '"org-a"')).toBe(true)
    m.returning = []
    expect(await s.withdrawAudio('au-de-otro', new Date())).toBe(false)
  })

  it('los audios se buscan con organización, estudio, sujeto y sin los ya retirados', async () => {
    const s = await real()
    await s.audiosOf()
    const where = JSON.stringify(m.log[0]!.where)
    for (const v of ['"org-a"', '"st-1"', '"su-1"', 'withdrawnAt']) expect(where).toContain(v)
  })

  it('un depósito que no devuelve id corta la anulación', async () => {
    m.returning = []
    const s = await real()
    await expect(s.insertDeposit({} as never)).rejects.toThrow('evolution_void_deposit_failed')
  })
})
