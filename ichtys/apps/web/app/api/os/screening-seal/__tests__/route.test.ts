import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * C3: un administrador sella las evaluaciones de elegibilidad anteriores al cifrado de **su**
 * organización. La organización sale del token, nunca del pedido. Ninguna respuesta lleva
 * contenido clínico: solo cantidades.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findOrg: vi.fn(),
  functionRows: vi.fn(),
  runOrgSeal: vi.fn(),
  store: { countRows: vi.fn(), countPlain: vi.fn(), countForeign: vi.fn(), keySamples: vi.fn(), sealBatch: vi.fn() },
  orgSealStore: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))
vi.mock('@ichtys/db', () => ({
  organizations: { clerkOrgId: 'clerk_org_id' },
  eq: (column: unknown, value: unknown) => ({ column, value }),
  db: {
    query: { organizations: { findFirst: mocks.findOrg } },
    select: () => ({ from: () => ({ where: mocks.functionRows }) }),
  },
  memberFunctions: { functionKey: 'mf.function_key', organizationId: 'mf.organization_id', userId: 'mf.user_id', revokedAt: 'mf.revoked_at' },
}))
vi.mock('../../../../../lib/subjects/screening-seal-run', () => ({ runOrgSeal: mocks.runOrgSeal }))
vi.mock('../../../../../lib/subjects/screening-seal-store', () => ({ orgSealStore: mocks.orgSealStore }))

import { GET, POST } from '../route'

const TARGET = 'ep-prueba.neon.tech/neondb'
const post = (body: unknown) =>
  new Request('https://os.example.test/api/os/screening-seal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const saved = { vercel: process.env.VERCEL_ENV, flag: process.env.ALPHI_SEAL_SCREENING, url: process.env.DATABASE_URL }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z'), toFake: ['Date'] })
  process.env.VERCEL_ENV = 'preview'
  delete process.env.ALPHI_SEAL_SCREENING
  process.env.DATABASE_URL = 'postgresql://usuario:secreto@ep-prueba.neon.tech/neondb?sslmode=require'
  mocks.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_clerk_a', orgRole: 'org:admin' })
  mocks.findOrg.mockResolvedValue({ id: 'org-a', accessMode: 'open' })
  mocks.functionRows.mockResolvedValue([])
  mocks.orgSealStore.mockReturnValue(mocks.store)
  mocks.store.countRows.mockResolvedValue(12)
  mocks.store.countPlain.mockResolvedValue(7)
  mocks.store.countForeign.mockResolvedValue(0)
  mocks.runOrgSeal.mockResolvedValue({ status: 'done', sealed: 7, batches: 1, remaining: 0, foreignEnvelope: 0 })
})

afterEach(() => {
  vi.useRealTimers()
  for (const [key, value] of [['VERCEL_ENV', saved.vercel], ['ALPHI_SEAL_SCREENING', saved.flag], ['DATABASE_URL', saved.url]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('GET /api/os/screening-seal — cuánto hay para sellar', () => {
  it('devuelve cantidades de la organización del token y a qué base apunta, sin credenciales', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ rows: 12, plain: 7, foreignEnvelope: 0, target: TARGET })
    expect(mocks.orgSealStore).toHaveBeenCalledWith('org-a')
    expect(JSON.stringify(body)).not.toContain('secreto')
    expect(mocks.runOrgSeal).not.toHaveBeenCalled()
  })

  it('sin sesión responde 401', async () => {
    mocks.auth.mockResolvedValue({ userId: null, orgId: null })
    expect((await GET()).status).toBe(401)
  })

  it('quien no administra la organización recibe 403 y no se cuenta nada', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_2', orgId: 'org_clerk_a', orgRole: 'org:member' })
    expect((await GET()).status).toBe(403)
    expect(mocks.orgSealStore).not.toHaveBeenCalled()
  })

  it('en producción, sin la variable encendida, la ruta no existe', async () => {
    process.env.VERCEL_ENV = 'production'
    expect((await GET()).status).toBe(404)
    expect(mocks.auth).not.toHaveBeenCalled()
  })

  it('pasada la fecha de baja la ruta no existe', async () => {
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'))
    expect((await GET()).status).toBe(404)
    expect((await POST(post({ confirm: TARGET }))).status).toBe(404)
  })
})

describe('POST /api/os/screening-seal — sellar', () => {
  it('con la base confirmada sella la organización del token, a nombre de quien lo pidió', async () => {
    const res = await POST(post({ confirm: TARGET }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'done', sealed: 7, batches: 1, remaining: 0, foreignEnvelope: 0 })
    expect(mocks.orgSealStore).toHaveBeenCalledWith('org-a')
    expect(mocks.runOrgSeal).toHaveBeenCalledWith(mocks.store, expect.objectContaining({ orgId: 'org-a', userId: 'user_1' }))
  })

  it('una organización escrita en el pedido se ignora: manda la del token', async () => {
    await POST(post({ confirm: TARGET, orgId: 'org-b', organizationId: 'org-b' }))
    expect(mocks.orgSealStore).toHaveBeenCalledWith('org-a')
    expect(mocks.runOrgSeal).toHaveBeenCalledWith(mocks.store, expect.objectContaining({ orgId: 'org-a' }))
  })

  it('si la base confirmada no es la de este entorno responde 409 y no escribe', async () => {
    const res = await POST(post({ confirm: 'ep-otra.neon.tech/neondb' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'target_mismatch' })
    expect(mocks.runOrgSeal).not.toHaveBeenCalled()
  })

  it('sin confirmación responde 400 y no escribe', async () => {
    expect((await POST(post({}))).status).toBe(400)
    expect(mocks.runOrgSeal).not.toHaveBeenCalled()
  })

  it('si la clave no se pudo comprobar responde 409 con el motivo y nada más', async () => {
    mocks.runOrgSeal.mockResolvedValue({ status: 'key_mismatch' })
    const res = await POST(post({ confirm: TARGET }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'key_mismatch' })
  })

  it('si una fila no vuelve igual responde 500 sin contenido ni identificadores', async () => {
    const error = new Error('La fila 123 no vuelve igual después de cifrar la columna summary')
    error.name = 'ScreeningSealRoundTripError'
    mocks.runOrgSeal.mockRejectedValue(error)
    const res = await POST(post({ confirm: TARGET }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'seal_failed', reason: 'round_trip' })
  })

  it('quien no administra la organización recibe 403 y no se sella', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_2', orgId: 'org_clerk_a', orgRole: 'org:member' })
    expect((await POST(post({ confirm: TARGET }))).status).toBe(403)
    expect(mocks.runOrgSeal).not.toHaveBeenCalled()
  })
})
