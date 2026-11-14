import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * C3: quien responde por el sistema sella las evaluaciones de elegibilidad anteriores al
 * cifrado, en todas las organizaciones. Solo los operadores de ALPHI_SEAL_OPERATORS; para
 * cualquier otra persona, administre lo que administre, la ruta no existe. Ninguna respuesta
 * lleva contenido clínico ni identificadores de organización: solo cantidades.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  runSeal: vi.fn(),
  sealOverview: vi.fn(),
  orgSealStore: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))
vi.mock('../../../../../lib/subjects/screening-seal-run', () => ({ runSeal: mocks.runSeal }))
vi.mock('../../../../../lib/subjects/screening-seal-store', () => ({ orgSealStore: mocks.orgSealStore, sealOverview: mocks.sealOverview }))

import { GET, POST } from '../route'

const TARGET = 'ep-prueba.neon.tech/neondb'
const OPERATOR = 'user_operador'
const post = (body: unknown) =>
  new Request('https://os.example.test/api/os/screening-seal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const saved = { operators: process.env.ALPHI_SEAL_OPERATORS, url: process.env.DATABASE_URL, vercel: process.env.VERCEL_ENV }
const DONE = { status: 'done', organizations: 2, sealed: 7, batches: 2, remaining: 0, foreignEnvelope: 0, keyMismatch: 0, keyUnverified: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z'), toFake: ['Date'] })
  process.env.ALPHI_SEAL_OPERATORS = OPERATOR
  process.env.DATABASE_URL = 'postgresql://usuario:secreto@ep-prueba.neon.tech/neondb?sslmode=require'
  mocks.auth.mockResolvedValue({ userId: OPERATOR, orgId: 'org_clerk_a', orgRole: 'org:member' })
  mocks.sealOverview.mockResolvedValue([
    { organizationId: 'org-a', rows: 12, plain: 7, foreignEnvelope: 0 },
    { organizationId: 'org-b', rows: 5, plain: 0, foreignEnvelope: 1 },
  ])
  mocks.runSeal.mockResolvedValue(DONE)
})

afterEach(() => {
  vi.useRealTimers()
  for (const [key, value] of [['ALPHI_SEAL_OPERATORS', saved.operators], ['DATABASE_URL', saved.url], ['VERCEL_ENV', saved.vercel]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('GET /api/os/screening-seal — cuánto hay para sellar', () => {
  it('al operador le devuelve cantidades de todo el sistema y a qué base apunta, sin credenciales ni organizaciones', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ organizations: 2, organizationsWithPlain: 1, rows: 17, plain: 7, foreignEnvelope: 1, target: TARGET })
    const text = JSON.stringify(body)
    expect(text).not.toContain('secreto')
    expect(text).not.toContain('org-a')
    expect(mocks.runSeal).not.toHaveBeenCalled()
  })

  it('no hace falta administrar ninguna organización: alcanza con ser operador', async () => {
    mocks.auth.mockResolvedValue({ userId: OPERATOR, orgId: null, orgRole: null })
    expect((await GET()).status).toBe(200)
  })

  it('sin sesión responde 401', async () => {
    mocks.auth.mockResolvedValue({ userId: null, orgId: null })
    expect((await GET()).status).toBe(401)
    expect(mocks.sealOverview).not.toHaveBeenCalled()
  })

  it('para quien no es operador la ruta no existe, aunque administre su organización', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_admin_del_centro', orgId: 'org_clerk_a', orgRole: 'org:admin' })
    expect((await GET()).status).toBe(404)
    expect((await POST(post({ confirm: TARGET }))).status).toBe(404)
    expect(mocks.sealOverview).not.toHaveBeenCalled()
    expect(mocks.runSeal).not.toHaveBeenCalled()
  })

  it('sin operadores cargados la ruta no existe en ningún entorno', async () => {
    delete process.env.ALPHI_SEAL_OPERATORS
    for (const env of ['preview', 'production', 'development']) {
      process.env.VERCEL_ENV = env
      expect((await GET()).status).toBe(404)
      expect((await POST(post({ confirm: TARGET }))).status).toBe(404)
    }
    expect(mocks.auth).not.toHaveBeenCalled()
  })

  it('pasada la fecha de baja la ruta no existe', async () => {
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'))
    expect((await GET()).status).toBe(404)
    expect((await POST(post({ confirm: TARGET }))).status).toBe(404)
  })
})

describe('POST /api/os/screening-seal — sellar', () => {
  it('con la base confirmada sella todo, a nombre del operador que lo pidió', async () => {
    const res = await POST(post({ confirm: TARGET }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(DONE)
    expect(mocks.runSeal).toHaveBeenCalledWith(
      { overview: mocks.sealOverview, storeFor: mocks.orgSealStore },
      expect.objectContaining({ userId: OPERATOR }),
    )
  })

  it('si la base confirmada no es la de este entorno responde 409 y no escribe', async () => {
    const res = await POST(post({ confirm: 'ep-otra.neon.tech/neondb' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'target_mismatch' })
    expect(mocks.runSeal).not.toHaveBeenCalled()
  })

  it('sin confirmación responde 400 y no escribe', async () => {
    expect((await POST(post({}))).status).toBe(400)
    expect(mocks.runSeal).not.toHaveBeenCalled()
  })

  it('si falta la clave responde 409 con el motivo y nada más', async () => {
    mocks.runSeal.mockResolvedValue({ status: 'no_key' })
    const res = await POST(post({ confirm: TARGET }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'no_key' })
  })

  it('si una fila no vuelve igual responde 500 sin contenido ni identificadores', async () => {
    const error = new Error('La fila 123 no vuelve igual después de cifrar la columna summary')
    error.name = 'ScreeningSealRoundTripError'
    mocks.runSeal.mockRejectedValue(error)
    const res = await POST(post({ confirm: TARGET }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'seal_failed', reason: 'round_trip' })
  })
})
