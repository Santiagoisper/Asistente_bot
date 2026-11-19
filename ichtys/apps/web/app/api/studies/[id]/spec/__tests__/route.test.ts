/**
 * GET /api/studies/[id]/spec (auditoría 19/11, H-03): el Spec vigente o su resumen,
 * siempre con la organización del acceso.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class AccessError extends Error {
    constructor(message: string, public status: 401 | 403 | 404) {
      super(message)
    }
  }
  return { AccessError, validateStudyAccess: vi.fn(), getLatest: vi.fn(), versions: vi.fn(), safeParse: vi.fn() }
})

vi.mock('@ichtys/auth', () => ({ AccessError: h.AccessError, validateStudyAccess: h.validateStudyAccess }))
vi.mock('@ichtys/ingestion', () => ({
  getLatestStudySpec: h.getLatest,
  studySpecSchema: { safeParse: h.safeParse },
  isMeaningfulSpec: () => true,
  specRichness: () => 7,
}))
vi.mock('@ichtys/db', () => {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, { from: () => chain, innerJoin: () => chain, where: () => h.versions() })
  return {
    db: { select: () => chain },
    and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a, inArray: (...a: unknown[]) => a,
    documents: {}, documentVersions: {},
  }
})

import { GET } from '../route'

const p = { params: Promise.resolve({ id: 'study-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  h.validateStudyAccess.mockResolvedValue({ orgId: 'org-1' })
})

describe('GET Study Spec', () => {
  it('sin acceso: el código del acceso y no lee el Spec', async () => {
    h.validateStudyAccess.mockRejectedValue(new h.AccessError('Not found', 404))
    expect((await GET(new Request('http://x'), p)).status).toBe(404)
    expect(h.getLatest).not.toHaveBeenCalled()
  })

  it('completo: lo pide con la organización del acceso', async () => {
    h.getLatest.mockResolvedValue({ version: 2, spec: { a: 1 } })
    const body = await (await GET(new Request('http://x'), p)).json()
    expect(h.getLatest).toHaveBeenCalledWith({ orgId: 'org-1', studyId: 'study-1' })
    expect(body).toEqual({ spec: { version: 2, spec: { a: 1 } } })
  })

  it('sin Spec todavía: spec null', async () => {
    h.getLatest.mockResolvedValue(null)
    expect(await (await GET(new Request('http://x'), p)).json()).toEqual({ spec: null })
  })

  it('resumen: avisa si el protocolo se está procesando y no manda el Spec', async () => {
    h.getLatest.mockResolvedValue({ version: 2, status: 'draft', spec: {} })
    h.versions.mockResolvedValue([{ status: 'ready' }, { status: 'processing' }])
    h.safeParse.mockReturnValue({ success: true, data: { extractionWarnings: ['w'] } })
    const body = await (await GET(new Request('http://x?summary=1'), p)).json()
    expect(body).toEqual({ version: 2, meaningful: true, richness: 7, protocolProcessing: true, extractionFailed: false, extractionWarnings: ['w'], status: 'draft' })
  })

  it('error inesperado: 500 sin detalle', async () => {
    h.getLatest.mockRejectedValue(new Error('detalle interno'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(new Request('http://x'), p)
    spy.mockRestore()
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('detalle interno')
  })
})
