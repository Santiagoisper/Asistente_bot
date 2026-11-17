import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** La pantalla tiene el mismo candado que la ruta: para quien no es operador no existe. */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('../../../../../components/ops/chat-seal-panel', () => ({ ChatSealPanel: () => null }))

import SelladoChatPage from '../page'

const saved = process.env.ALPHI_SEAL_OPERATORS

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ now: new Date('2026-11-20T12:00:00Z'), toFake: ['Date'] })
  process.env.ALPHI_SEAL_OPERATORS = 'user_operador'
})
afterEach(() => {
  vi.useRealTimers()
  if (saved === undefined) delete process.env.ALPHI_SEAL_OPERATORS
  else process.env.ALPHI_SEAL_OPERATORS = saved
})

describe('pantalla de sellado del chat', () => {
  it('el operador la ve', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_operador' })
    await expect(SelladoChatPage()).resolves.toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('para un administrador del centro que no es operador no existe', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user_admin', orgRole: 'org:admin' })
    await expect(SelladoChatPage()).rejects.toThrow('NOT_FOUND')
  })

  it('sin sesión no existe', async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(SelladoChatPage()).rejects.toThrow('NOT_FOUND')
  })

  it('sin operadores cargados no existe, y ni siquiera mira la sesión', async () => {
    delete process.env.ALPHI_SEAL_OPERATORS
    await expect(SelladoChatPage()).rejects.toThrow('NOT_FOUND')
    expect(mocks.auth).not.toHaveBeenCalled()
  })

  it('pasada la fecha de baja no existe', async () => {
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'))
    mocks.auth.mockResolvedValue({ userId: 'user_operador' })
    await expect(SelladoChatPage()).rejects.toThrow('NOT_FOUND')
  })
})
