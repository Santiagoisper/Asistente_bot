import { describe, expect, it, vi } from 'vitest'
import { PhiConfigError } from '../phi-fields'
import { ScreeningSealRoundTripError, type RowSealPlan, type ScreeningRowToSeal } from '../screening-seal'
import { runOrgSeal, type SealStore } from '../screening-seal-run'

/**
 * C3: el sellado de las evaluaciones de elegibilidad anteriores al cifrado, disparado desde
 * la aplicación por un administrador para **su** organización. Acá se prueba el recorrido
 * (clave, tandas, tope de tiempo, registro) contra un depósito de mentira; la base real se
 * prueba en el entorno de prueba.
 */
const ORG = 'org-a'
const USER = 'user_admin'

function fakeStore(overrides: Partial<SealStore> & { batches?: number[] } = {}) {
  const queue = [...(overrides.batches ?? [])]
  let plain = queue.reduce((total, n) => total + n, 0)
  const store: SealStore = {
    countRows: vi.fn(async () => 10),
    countPlain: vi.fn(async () => plain),
    countForeign: vi.fn(async () => 0),
    keySamples: vi.fn(async () => ['cifrado-1']),
    sealBatch: vi.fn(async () => {
      const written = queue.shift() ?? 0
      plain -= written
      return written
    }),
    ...overrides,
  }
  return store
}

const base = { orgId: ORG, userId: USER, batchSize: 200, budgetMs: 20_000 }
const keyOk = { checkKey: () => 'ok' as const, probeKey: () => undefined }

describe('runOrgSeal — sellar lo anterior al cifrado, una organización', () => {
  it('sin nada en claro termina sin comprobar la clave ni escribir', async () => {
    const store = fakeStore()
    const outcome = await runOrgSeal(store, { ...base, ...keyOk })
    expect(outcome).toEqual({ status: 'done', sealed: 0, batches: 0, remaining: 0, foreignEnvelope: 0 })
    expect(store.keySamples).not.toHaveBeenCalled()
    expect(store.sealBatch).not.toHaveBeenCalled()
  })

  it('sella por tandas hasta que no queda nada y cuenta lo escrito', async () => {
    const store = fakeStore({ batches: [200, 200, 37] })
    const outcome = await runOrgSeal(store, { ...base, ...keyOk })
    expect(outcome).toEqual({ status: 'done', sealed: 437, batches: 3, remaining: 0, foreignEnvelope: 0 })
    expect(store.sealBatch).toHaveBeenCalledTimes(3)
    expect(vi.mocked(store.sealBatch).mock.calls[0]![0]).toBe(200)
  })

  it('cada tanda deja su registro: quién, en qué organización y cuántas filas, sin contenido', async () => {
    const store = fakeStore({ batches: [5] })
    await runOrgSeal(store, { ...base, ...keyOk })
    const audit = vi.mocked(store.sealBatch).mock.calls[0]![2]
    const entry = audit(5)
    expect(entry).toMatchObject({ action: 'admin.action', orgId: ORG, userId: USER, resourceType: 'screening_assessments' })
    expect(entry.metadata).toMatchObject({ type: 'screening_assessments_encrypted_at_rest', rows: 5, contentChanged: false, operator: USER })
  })

  it('si falta la clave no abre ninguna tanda', async () => {
    const store = fakeStore({ batches: [5] })
    const outcome = await runOrgSeal(store, {
      ...base,
      checkKey: () => 'ok',
      probeKey: () => {
        throw new PhiConfigError('falta la clave')
      },
    })
    expect(outcome).toEqual({ status: 'no_key' })
    expect(store.sealBatch).not.toHaveBeenCalled()
  })

  it('si la clave no descifra lo que la organización ya tiene cifrado, no escribe', async () => {
    const store = fakeStore({ batches: [5] })
    const outcome = await runOrgSeal(store, { ...base, probeKey: () => undefined, checkKey: () => 'mismatch' })
    expect(outcome).toEqual({ status: 'key_mismatch' })
    expect(store.sealBatch).not.toHaveBeenCalled()
  })

  it('si no hay nada cifrado contra qué comprobar la clave, no escribe', async () => {
    const store = fakeStore({ batches: [5], keySamples: vi.fn(async () => []) })
    const outcome = await runOrgSeal(store, { ...base, probeKey: () => undefined, checkKey: () => 'no_sample' })
    expect(outcome).toEqual({ status: 'key_unverified' })
    expect(store.sealBatch).not.toHaveBeenCalled()
  })

  it('al llegar al tope de tiempo corta entre tandas y dice cuánto quedó', async () => {
    let clock = 0
    const store = fakeStore({ batches: [200, 200, 200] })
    vi.mocked(store.sealBatch).mockImplementation(async () => {
      clock += 12_000
      return 200
    })
    vi.mocked(store.countPlain).mockResolvedValueOnce(600).mockResolvedValueOnce(200)
    const outcome = await runOrgSeal(store, { ...base, ...keyOk, now: () => clock })
    expect(outcome).toEqual({ status: 'partial', sealed: 400, batches: 2, remaining: 200, foreignEnvelope: 0 })
  })

  it('una tanda que no escribe nada (filas tomadas por otra escritura) corta: no gira en vacío', async () => {
    const store = fakeStore({ batches: [] })
    vi.mocked(store.countPlain).mockResolvedValue(3)
    const outcome = await runOrgSeal(store, { ...base, ...keyOk })
    expect(outcome).toEqual({ status: 'partial', sealed: 0, batches: 0, remaining: 3, foreignEnvelope: 0 })
    expect(store.sealBatch).toHaveBeenCalledTimes(1)
  })

  it('informa las columnas con un sobre de otra versión aunque no quede nada en claro', async () => {
    const store = fakeStore({ countForeign: vi.fn(async () => 2) })
    const outcome = await runOrgSeal(store, { ...base, ...keyOk })
    expect(outcome).toEqual({ status: 'partial', sealed: 0, batches: 0, remaining: 0, foreignEnvelope: 2 })
  })

  it('si una fila no vuelve igual, el error sale tal cual: la tanda la cancela quien abrió la transacción', async () => {
    const store = fakeStore({ batches: [5] })
    vi.mocked(store.sealBatch).mockImplementation(async (_limit, plan: (row: ScreeningRowToSeal) => RowSealPlan) => {
      void plan
      throw new ScreeningSealRoundTripError('fila-1', 'summary')
    })
    await expect(runOrgSeal(store, { ...base, ...keyOk })).rejects.toBeInstanceOf(ScreeningSealRoundTripError)
  })
})
