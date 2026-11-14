import { describe, expect, it, vi } from 'vitest'
import { PhiConfigError } from '../phi-fields'
import { ScreeningSealRoundTripError, type RowSealPlan, type ScreeningRowToSeal } from '../screening-seal'
import { runOrgSeal, runSeal, type OrgSealOptions, type OrgSealOutcome, type SealStore } from '../screening-seal-run'

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

  it('sin nada propio contra qué comprobar, pero con la clave ya comprobada contra el sistema, sella', async () => {
    const store = fakeStore({ batches: [5], keySamples: vi.fn(async () => []) })
    const outcome = await runOrgSeal(store, { ...base, probeKey: () => undefined, checkKey: () => 'no_sample', keyVerified: true })
    expect(outcome).toEqual({ status: 'done', sealed: 5, batches: 1, remaining: 0, foreignEnvelope: 0 })
  })

  it('si lo propio está cifrado con otra clave no escribe, aunque la clave sirva para el resto del sistema', async () => {
    const store = fakeStore({ batches: [5] })
    const outcome = await runOrgSeal(store, { ...base, probeKey: () => undefined, checkKey: () => 'mismatch', keyVerified: true })
    expect(outcome).toEqual({ status: 'key_mismatch' })
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

/**
 * Sellar lo anterior es obligación de quien responde por el sistema, no una opción de cada
 * centro (C3): el operador recorre todas las organizaciones, una por una.
 */
describe('runSeal — todas las organizaciones, a nombre del operador', () => {
  const options = { userId: USER, batchSize: 200, budgetMs: 20_000, probeKey: () => undefined, checkKey: (samples: readonly string[]) => (samples[0] === 'descifra' ? ('ok' as const) : ('mismatch' as const)) }
  const row = (organizationId: string, plain: number, foreignEnvelope = 0) => ({ organizationId, rows: plain + 3, plain, foreignEnvelope })

  function setup(before: ReturnType<typeof row>[], after: ReturnType<typeof row>[], outcomes: Record<string, OrgSealOutcome>) {
    const overview = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after)
    const storeFor = vi.fn((orgId: string) => ({ orgId }) as unknown as SealStore)
    const keySamples = vi.fn(async () => ['descifra'])
    const sealOrg = vi.fn(async (_store: SealStore, opts: OrgSealOptions): Promise<OrgSealOutcome> => outcomes[opts.orgId]!)
    return { overview, storeFor, keySamples, sealOrg }
  }
  const sealedOrg = (sealed: number, batches = 1): OrgSealOutcome => ({ status: 'done', sealed, batches, remaining: 0, foreignEnvelope: 0 })

  it('sella cada organización que tiene algo en claro y deja en paz a las que no', async () => {
    const deps = setup([row('org-a', 5), row('org-b', 0), row('org-c', 9)], [row('org-a', 0), row('org-b', 0), row('org-c', 0)], {
      'org-a': sealedOrg(5),
      'org-c': sealedOrg(9, 2),
    })
    const outcome = await runSeal(deps, options)
    expect(outcome).toEqual({ status: 'done', organizations: 2, sealed: 14, batches: 3, remaining: 0, foreignEnvelope: 0, keyMismatch: 0, keyUnverified: 0 })
    expect(deps.storeFor.mock.calls.map((call) => call[0])).toEqual(['org-a', 'org-c'])
    expect(deps.sealOrg.mock.calls.map((call) => [call[1].orgId, call[1].userId])).toEqual([
      ['org-a', USER],
      ['org-c', USER],
    ])
  })

  it('sin nada en claro en ninguna organización no abre ningún depósito', async () => {
    const deps = setup([row('org-a', 0)], [row('org-a', 0)], {})
    expect(await runSeal(deps, options)).toEqual({ status: 'done', organizations: 0, sealed: 0, batches: 0, remaining: 0, foreignEnvelope: 0, keyMismatch: 0, keyUnverified: 0 })
    expect(deps.storeFor).not.toHaveBeenCalled()
  })

  it('si falta la clave corta en la primera organización', async () => {
    const deps = setup([row('org-a', 5), row('org-b', 5)], [], { 'org-a': { status: 'no_key' } })
    expect(await runSeal(deps, options)).toEqual({ status: 'no_key' })
    expect(deps.sealOrg).toHaveBeenCalledTimes(1)
  })

  it('una organización cuya clave no se pudo comprobar no frena a las demás, y se informa', async () => {
    const deps = setup([row('org-a', 5), row('org-b', 4), row('org-c', 2)], [row('org-a', 5), row('org-b', 0), row('org-c', 2)], {
      'org-a': { status: 'key_mismatch' },
      'org-b': sealedOrg(4),
      'org-c': { status: 'key_unverified' },
    })
    expect(await runSeal(deps, options)).toEqual({ status: 'partial', organizations: 1, sealed: 4, batches: 1, remaining: 7, foreignEnvelope: 0, keyMismatch: 1, keyUnverified: 1 })
  })

  it('el tope de tiempo es uno solo para todo el pedido: lo que no entró queda para el siguiente', async () => {
    let clock = 0
    const deps = setup([row('org-a', 5), row('org-b', 4)], [row('org-a', 0), row('org-b', 4)], { 'org-a': sealedOrg(5) })
    deps.sealOrg.mockImplementation(async (_store, opts) => {
      expect(opts.budgetMs).toBe(20_000)
      clock += 25_000
      return sealedOrg(5)
    })
    const outcome = await runSeal(deps, { ...options, now: () => clock })
    expect(outcome).toEqual({ status: 'partial', organizations: 1, sealed: 5, batches: 1, remaining: 4, foreignEnvelope: 0, keyMismatch: 0, keyUnverified: 0 })
    expect(deps.sealOrg).toHaveBeenCalledTimes(1)
  })

  it('a la organización siguiente le toca el tiempo que quedó', async () => {
    let clock = 0
    const budgets: number[] = []
    const deps = setup([row('org-a', 5), row('org-b', 4)], [row('org-a', 0), row('org-b', 0)], {})
    deps.sealOrg.mockImplementation(async (_store, opts) => {
      budgets.push(opts.budgetMs)
      clock += 8_000
      return sealedOrg(1)
    })
    await runSeal(deps, { ...options, now: () => clock })
    expect(budgets).toEqual([20_000, 12_000])
  })

  it('los sobres de otra versión se informan y dejan el resultado en parcial', async () => {
    const deps = setup([row('org-a', 0, 2)], [row('org-a', 0, 2)], {})
    expect(await runSeal(deps, options)).toMatchObject({ status: 'partial', foreignEnvelope: 2, remaining: 0 })
  })
})

/**
 * La clave es una sola para todo el sistema y es la de la aplicación. Se comprueba una vez,
 * contra lo cifrado de cualquier organización: una organización sin nada propio cifrado no
 * puede quedar sin sellar para siempre (observación de Architect).
 */
describe('runSeal — la clave se comprueba una vez, contra todo el sistema', () => {
  const options = { userId: USER, batchSize: 200, budgetMs: 20_000, probeKey: () => undefined }
  const overviewOf = (plain: number) => [{ organizationId: 'org-a', rows: plain + 1, plain, foreignEnvelope: 0 }]
  const done: OrgSealOutcome = { status: 'done', sealed: 1, batches: 1, remaining: 0, foreignEnvelope: 0 }

  function deps(samples: string[], plain = 3) {
    return {
      overview: vi.fn(async () => overviewOf(plain)),
      storeFor: vi.fn(() => ({}) as unknown as SealStore),
      keySamples: vi.fn(async () => samples),
      sealOrg: vi.fn(async (_store: SealStore, _opts: OrgSealOptions): Promise<OrgSealOutcome> => done),
    }
  }
  const checkKey = (samples: readonly string[]) => (samples[0] === 'descifra' ? ('ok' as const) : ('mismatch' as const))

  it('si alguna muestra del sistema se descifra, cada organización recibe la clave como comprobada', async () => {
    const d = deps(['otra-clave', 'descifra'])
    await runSeal(d, { ...options, checkKey })
    expect(d.sealOrg.mock.calls[0]![1].keyVerified).toBe(true)
  })

  it('si ninguna muestra del sistema se descifra, no se da por comprobada', async () => {
    const d = deps(['otra-clave'])
    await runSeal(d, { ...options, checkKey })
    expect(d.sealOrg.mock.calls[0]![1].keyVerified).toBe(false)
  })

  it('sin nada cifrado en todo el sistema, no se da por comprobada', async () => {
    const d = deps([])
    await runSeal(d, { ...options, checkKey })
    expect(d.sealOrg.mock.calls[0]![1].keyVerified).toBe(false)
  })

  it('sin nada en claro no se leen muestras', async () => {
    const d = deps(['descifra'], 0)
    await runSeal(d, { ...options, checkKey })
    expect(d.keySamples).not.toHaveBeenCalled()
  })

  it('si falta la clave no se leen muestras ni se abre ninguna organización', async () => {
    const d = deps(['descifra'])
    const outcome = await runSeal(d, {
      ...options,
      checkKey,
      probeKey: () => {
        throw new PhiConfigError('falta la clave')
      },
    })
    expect(outcome).toEqual({ status: 'no_key' })
    expect(d.keySamples).not.toHaveBeenCalled()
    expect(d.sealOrg).not.toHaveBeenCalled()
  })
})
