import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La tarea diaria de borrado de grabaciones vencidas (D14) recorre también el depósito de
 * grabaciones sin sujeto (D24): mismo plazo, misma regla, y un registro por cada borrado.
 */
const mocks = vi.hoisted(() => ({
  purgeSubjects: vi.fn(),
  purgeUnassigned: vi.fn(),
  insertAuditLog: vi.fn(),
  transactions: 0,
}))

vi.mock('@ichtys/db', () => ({
  db: {
    transaction: async <T,>(work: (tx: unknown) => Promise<T>) => {
      mocks.transactions += 1
      return work({ tx: true })
    },
  },
}))
vi.mock('../../../../../lib/audit/audited-write', () => ({ insertAuditLog: mocks.insertAuditLog }))
vi.mock('../../../../../lib/dictation/audio-store', () => ({
  purgeExpiredDictationAudios: mocks.purgeSubjects,
  purgeExpiredUnassignedAudios: mocks.purgeUnassigned,
}))

import { GET } from '../route'

const request = (secret?: string) => new Request('http://localhost/api/cron/purge-dictation-audio', { headers: secret ? { authorization: `Bearer ${secret}` } : {} })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transactions = 0
  process.env.CRON_SECRET = 'secreto-de-prueba'
  mocks.purgeSubjects.mockResolvedValue([])
  mocks.purgeUnassigned.mockResolvedValue([])
  mocks.insertAuditLog.mockResolvedValue(undefined)
})
afterEach(() => {
  delete process.env.CRON_SECRET
})

describe('GET /api/cron/purge-dictation-audio', () => {
  it('sin el secreto no corre nada', async () => {
    expect((await GET(request())).status).toBe(401)
    expect((await GET(request('otro'))).status).toBe(401)
    expect(mocks.purgeSubjects).not.toHaveBeenCalled()
    expect(mocks.purgeUnassigned).not.toHaveBeenCalled()
  })

  it('borra lo vencido de los sujetos y del depósito en una sola transacción, con la misma hora', async () => {
    await GET(request('secreto-de-prueba'))
    expect(mocks.transactions).toBe(1)
    const [, subjectsNow] = mocks.purgeSubjects.mock.calls[0] as [unknown, Date]
    const [, unassignedNow] = mocks.purgeUnassigned.mock.calls[0] as [unknown, Date]
    expect(unassignedNow).toBe(subjectsNow)
  })

  it('deja un registro por cada grabación borrada, y dice de cuál de las dos tablas era', async () => {
    mocks.purgeSubjects.mockResolvedValue([{ id: 'audio-1', organizationId: 'org-1', studyId: 'study-1' }])
    mocks.purgeUnassigned.mockResolvedValue([
      { id: 'deposito-1', organizationId: 'org-1', studyId: 'study-1' },
      { id: 'deposito-2', organizationId: 'org-2', studyId: 'study-9' },
    ])

    const res = await GET(request('secreto-de-prueba'))

    expect(await res.json()).toEqual({ ok: true, purged: 1, purgedUnassigned: 2 })
    expect(mocks.insertAuditLog.mock.calls.map(([, entry]) => [entry.action, entry.resourceType, entry.resourceId, entry.orgId, entry.userId])).toEqual([
      ['evolution.audio.purge', 'dictation_audio', 'audio-1', 'org-1', 'system:retention'],
      ['evolution.audio.purge', 'unassigned_dictation_audio', 'deposito-1', 'org-1', 'system:retention'],
      ['evolution.audio.purge', 'unassigned_dictation_audio', 'deposito-2', 'org-2', 'system:retention'],
    ])
  })

  it('si el borrado del depósito falla, responde error: la transacción deshace también lo de los sujetos', async () => {
    mocks.purgeSubjects.mockResolvedValue([{ id: 'audio-1', organizationId: 'org-1', studyId: 'study-1' }])
    mocks.purgeUnassigned.mockRejectedValue(new Error('sin conexión'))
    const res = await GET(request('secreto-de-prueba'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'purge_failed' })
  })
})
