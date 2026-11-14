import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El acceso a la base de la anulación (D24). Lo que se prueba acá es el orden que cierra la
 * carrera con una grabación que está subiendo: primero el bloqueo de la evolución, después
 * mirarla, las dos cosas en la transacción.
 */
const mocks = vi.hoisted(() => ({ order: [] as string[], lock: vi.fn(), find: vi.fn() }))

vi.mock('@ichtys/db', () => ({ and: vi.fn(), asc: vi.fn(), eq: vi.fn(), isNull: vi.fn(), dictationAudios: {}, evolutionVoids: {}, unassignedDictationAudios: {} }))
vi.mock('../../audit/audited-write', () => ({ insertAuditLog: vi.fn() }))
vi.mock('../phi-fields', () => ({ encryptClinicalContent: (text: string) => `enc:${text}` }))
vi.mock('../evolution-reader', () => ({ lockSubjectEvolution: mocks.lock, findSubjectEvolution: mocks.find }))

import { txVoidStore } from '../evolution-void-store'

const SCOPE = { orgId: 'org-1', studyId: 'study-1', subjectId: 'subject-1', evolutionId: 'evo-1' }
const tx = { marca: 'transaccion' } as never

beforeEach(() => {
  mocks.order.length = 0
  mocks.lock.mockReset().mockImplementation(async () => {
    mocks.order.push('bloqueo')
    return true
  })
  mocks.find.mockReset().mockImplementation(async () => {
    mocks.order.push('mirar')
    return { id: 'evo-1', authorUserId: 'user_a', voided: null }
  })
})

describe('txVoidStore.findEvolution', () => {
  it('toma el bloqueo exclusivo de la evolución y recién después la mira, con las anuladas, en la transacción', async () => {
    const found = await txVoidStore(tx, SCOPE).findEvolution()

    expect(found).toEqual({ id: 'evo-1', authorUserId: 'user_a', voided: null })
    expect(mocks.order).toEqual(['bloqueo', 'mirar'])
    expect(mocks.lock).toHaveBeenCalledWith(SCOPE, 'update', tx)
    expect(mocks.find).toHaveBeenCalledWith(SCOPE, 'with-voided', tx)
  })

  it('si la evolución no está, no sigue', async () => {
    mocks.lock.mockResolvedValue(false)
    expect(await txVoidStore(tx, SCOPE).findEvolution()).toBeNull()
    expect(mocks.find).not.toHaveBeenCalled()
  })
})
