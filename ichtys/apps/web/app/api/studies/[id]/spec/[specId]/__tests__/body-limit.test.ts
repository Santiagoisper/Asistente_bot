/**
 * Rojo-verde del PATCH de spec (vuelta 3, H7 — repro del Sicario):
 * cuerpos por DEBAJO del tope de 2 MiB con sourcePages masivos.
 *
 * Contra el HEAD anterior (2e86bb1):
 *  - 120k sourcePages inválidos (480 KB) → antes 120.000 issues en la
 *    respuesta (~18 MB); ahora el .max(100) corta en 1 issue y la
 *    respuesta lista ≤ 10 issues (código y ruta).
 *  - 400k inválidos (1,6 MB) → antes ~400.000 issues (~141 MiB de heap);
 *    ahora 1 issue.
 *  - 150k VÁLIDOS (~900 KB) → antes PASABA el schema; ahora too_big.
 *  - specId inexistente o no draft → se responde ANTES de leer/parsear el
 *    cuerpo (el fetch del target se adelantó).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 403 | 404,
    ) {
      super(message)
      this.name = 'AccessError'
    }
  }

  return {
    AccessError: MockAccessError,
    validateStudyAccess: vi.fn(),
    findFirst: vi.fn(),
    dbUpdate: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    })),
  }
})

vi.mock('@ichtys/auth', () => ({
  validateStudyAccess: mocks.validateStudyAccess,
  AccessError: mocks.AccessError,
  handleApiError: vi.fn((err: unknown) => {
    if (err instanceof mocks.AccessError) {
      return new Response('Unauthorized', { status: err.status })
    }
    return new Response('Internal Server Error', { status: 500 })
  }),
}))

vi.mock('@ichtys/db', () => ({
  and: (...parts: unknown[]) => parts,
  eq: (col: unknown, val: unknown) => [col, val],
  studySpecs: {},
  db: {
    query: { studySpecs: { findFirst: mocks.findFirst } },
    update: mocks.dbUpdate,
  },
}))

import { PATCH } from '../route'

const STUDY_ID = crypto.randomUUID()
const SPEC_ID = crypto.randomUUID()

function makeParams() {
  return { params: Promise.resolve({ id: STUDY_ID, specId: SPEC_ID }) }
}

function draftTarget() {
  return { id: SPEC_ID, status: 'draft' as const, organizationId: 'org', studyId: STUDY_ID }
}

function specWithSourcePages(pages: number[]): { spec: unknown } {
  return {
    spec: {
      identification: { protocolCode: null, title: null, phase: null, sourcePages: pages },
      inclusionCriteria: [],
      exclusionCriteria: [],
      endpoints: [],
      visits: [],
    },
  }
}

function post(body: string | unknown): Promise<Response> {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  return PATCH(
    new Request(`http://localhost/api/studies/${STUDY_ID}/spec/${SPEC_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }),
    makeParams(),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.validateStudyAccess.mockResolvedValue({ orgId: 'org', userId: 'u' })
})

describe('PATCH spec — sourcePages masivo bajo el tope de 2 MiB (repro del Sicario)', () => {
  it('120.000 inválidos (480 KB): 1 issue too_big, respuesta acotada', async () => {
    mocks.findFirst.mockResolvedValue(draftTarget())
    const body = specWithSourcePages(Array.from({ length: 120_000 }, () => 0)) // 0 no es positive

    const res = await post(body)
    expect(res.status).toBe(400)

    const payload = (await res.json()) as {
      totalIssues: number
      issues: Array<{ path: string; code: string }>
    }
    expect(payload.totalIssues).toBe(1)
    expect(payload.issues).toHaveLength(1)
    expect(payload.issues[0]).toEqual({
      path: 'identification.sourcePages',
      code: 'too_big',
    })
    // La respuesta es chica: antes del fix pesaba ~18 MB.
    expect(JSON.stringify(payload).length).toBeLessThan(4096)
    expect(mocks.dbUpdate).not.toHaveBeenCalled()
  })

  it('400.000 inválidos (1,6 MB): el gate corta en 1 issue', { timeout: 60_000 }, async () => {
    mocks.findFirst.mockResolvedValue(draftTarget())
    const body = specWithSourcePages(Array.from({ length: 400_000 }, () => -1))

    const res = await post(body)
    expect(res.status).toBe(400)
    const payload = (await res.json()) as { totalIssues: number }
    expect(payload.totalIssues).toBe(1)
  })

  it('150.000 VÁLIDOS (~900 KB): too_big — antes pasaban el schema', async () => {
    mocks.findFirst.mockResolvedValue(draftTarget())
    const body = specWithSourcePages(Array.from({ length: 150_000 }, (_, i) => i + 1))

    const res = await post(body)
    expect(res.status).toBe(400)
    const payload = (await res.json()) as {
      totalIssues: number
      issues: Array<{ code: string; path: string }>
    }
    expect(payload.totalIssues).toBe(1)
    expect(payload.issues[0]?.code).toBe('too_big')
  })
})

describe('PATCH spec — el target se comprueba antes de tocar el cuerpo', () => {
  it('specId inexistente + cuerpo gigante → 404 sin leer ni parsear el body', async () => {
    mocks.findFirst.mockResolvedValue(undefined)

    const res = await post('x'.repeat(3 * 1024 * 1024)) // 3 MB: ni el 413 — el 404 sale antes
    expect(res.status).toBe(404)
    expect(mocks.dbUpdate).not.toHaveBeenCalled()
  })

  it('spec no draft + body inválido → 400 de draft, sin parsear', async () => {
    mocks.findFirst.mockResolvedValue({ ...draftTarget(), status: 'approved' as const })

    const res = await post('esto no es json')
    expect(res.status).toBe(400)
    const payload = (await res.json()) as { error: string }
    expect(payload.error).toBe('Only draft specs can be edited')
    expect(mocks.dbUpdate).not.toHaveBeenCalled()
  })
})
