import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Sellado del chat anterior al cifrado: solo los operadores de ALPHI_SEAL_OPERATORS; para
 * cualquier otra persona la ruta no existe. Ninguna respuesta lleva texto del chat ni
 * identificadores de organización: solo cantidades.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  runChatSeal: vi.fn(),
  chatSealOverview: vi.fn(),
  orgChatSealStore: vi.fn(),
  chatSealKeySamples: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))
vi.mock('../../../../../lib/chat/chat-seal', () => ({ runChatSeal: mocks.runChatSeal }))
vi.mock('../../../../../lib/chat/chat-seal-store', () => ({
  orgChatSealStore: mocks.orgChatSealStore,
  chatSealOverview: mocks.chatSealOverview,
  chatSealKeySamples: mocks.chatSealKeySamples,
}))

import { GET, POST } from '../route'

const TARGET = 'ep-prueba.neon.tech/neondb'
const OPERATOR = 'user_operador'
const post = (body: unknown) =>
  new Request('https://os.example.test/api/os/chat-seal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const saved = { operators: process.env.ALPHI_SEAL_OPERATORS, url: process.env.DATABASE_URL, vercel: process.env.VERCEL_ENV }
const DONE = { status: 'done', organizations: 2, messages: 9, titles: 3, annotationsCleared: 4, batches: 2, remainingMessages: 0, remainingTitles: 0, remainingAnnotations: 0, blocked: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z'), toFake: ['Date'] })
  process.env.ALPHI_SEAL_OPERATORS = OPERATOR
  process.env.DATABASE_URL = 'postgresql://usuario:secreto@ep-prueba.neon.tech/neondb?sslmode=require'
  mocks.auth.mockResolvedValue({ userId: OPERATOR, orgId: 'org_clerk_a', orgRole: 'org:member' })
  mocks.chatSealOverview.mockResolvedValue([
    { organizationId: 'org-a', messages: 12, plainMessages: 9, plainTitles: 3, annotations: 4 },
    { organizationId: 'org-b', messages: 5, plainMessages: 0, plainTitles: 0, annotations: 0 },
  ])
  mocks.runChatSeal.mockResolvedValue(DONE)
})

afterEach(() => {
  vi.useRealTimers()
  for (const [key, value] of [['ALPHI_SEAL_OPERATORS', saved.operators], ['DATABASE_URL', saved.url], ['VERCEL_ENV', saved.vercel]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('GET /api/os/chat-seal — cuánto hay en claro', () => {
  it('al operador le devuelve cantidades de todo el sistema y a qué base apunta, sin credenciales ni organizaciones', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ organizations: 2, organizationsWithPlain: 1, messages: 17, plainMessages: 9, plainTitles: 3, annotations: 4, target: TARGET })
    const text = JSON.stringify(body)
    expect(text).not.toContain('secreto')
    expect(text).not.toContain('org-a')
    expect(mocks.runChatSeal).not.toHaveBeenCalled()
  })

  it('sin sesión responde 401', async () => {
    mocks.auth.mockResolvedValue({ userId: null, orgId: null })
    expect((await GET()).status).toBe(401)
    expect(mocks.chatSealOverview).not.toHaveBeenCalled()
  })

  it('para quien no es operador la ruta no existe, aunque administre su organización', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_admin_del_centro', orgId: 'org_clerk_a', orgRole: 'org:admin' })
    expect((await GET()).status).toBe(404)
    expect((await POST(post({ confirm: TARGET }))).status).toBe(404)
    expect(mocks.chatSealOverview).not.toHaveBeenCalled()
    expect(mocks.runChatSeal).not.toHaveBeenCalled()
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

describe('POST /api/os/chat-seal — sellar', () => {
  it('con la base confirmada sella todo, a nombre del operador que lo pidió', async () => {
    const res = await POST(post({ confirm: TARGET }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(DONE)
    expect(mocks.runChatSeal).toHaveBeenCalledWith(
      { overview: mocks.chatSealOverview, keySamples: mocks.chatSealKeySamples, storeFor: mocks.orgChatSealStore },
      expect.objectContaining({ userId: OPERATOR }),
    )
  })

  it('si la base confirmada no es la de este entorno responde 409 y no escribe', async () => {
    const res = await POST(post({ confirm: 'ep-otra.neon.tech/neondb' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'target_mismatch' })
    expect(mocks.runChatSeal).not.toHaveBeenCalled()
  })

  it('sin confirmación responde 400 y no escribe', async () => {
    expect((await POST(post({}))).status).toBe(400)
    expect(mocks.runChatSeal).not.toHaveBeenCalled()
  })

  it.each(['no_key', 'key_mismatch', 'key_unverified'])('si la clave no sirve (%s) responde 409 con el motivo y nada más', async (status) => {
    mocks.runChatSeal.mockResolvedValue({ status })
    const res = await POST(post({ confirm: TARGET }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: status })
  })

  it('si una fila no vuelve igual responde 500 sin contenido ni identificadores', async () => {
    const error = new Error('chat-seal: la fila 123 (message) no vuelve igual después de cifrar')
    error.name = 'ChatSealRoundTripError'
    mocks.runChatSeal.mockRejectedValue(error)
    const res = await POST(post({ confirm: TARGET }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'seal_failed', reason: 'round_trip' })
  })
})
