import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * C5: el asistente solo recibe el protocolo extraído que una persona aprobó. Un borrador no entra
 * como contexto, aunque sea lo único que hay: el asistente responde con los fragmentos del
 * documento, que son la fuente.
 */
const mocks = vi.hoisted(() => ({ getLatestStudySpec: vi.fn() }))

vi.mock('@ichtys/ingestion', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLatestStudySpec: mocks.getLatestStudySpec,
}))

import { getSpecContextChunks } from '../spec-context'
import { UNAPPROVED_SPEC_TITLE_SUFFIX } from '../../subjects/spec-notice'

const SPEC = {
  identification: { protocolCode: 'INV-001', title: 'Estudio inventado', phase: '2b', sourcePages: [1] },
  inclusionCriteria: [{ number: '1', text: 'Edad de 18 años o más', sourcePages: [12], confidence: 'high' as const }],
  exclusionCriteria: [],
  endpoints: [],
  visits: [],
}
const row = (status: string) => ({ id: 'spec-1', version: 1, status, documentVersionId: 'doc-v1', spec: SPEC })
const question = { question: '¿Cuál es la edad mínima para participar?', orgId: 'org-1', studyId: 'study-1' }

/** Responde según lo que se le pide, así se nota si alguien deja de pedir el aprobado. */
const store = (rows: { approved: unknown; latest: unknown }) =>
  mocks.getLatestStudySpec.mockImplementation(async (params: { approvedOnly?: boolean }) => (params.approvedOnly ? rows.approved : rows.latest))

beforeEach(() => {
  mocks.getLatestStudySpec.mockReset()
})

describe('getSpecContextChunks — solo el protocolo aprobado', () => {
  it('pide el aprobado', async () => {
    store({ approved: null, latest: row('draft') })
    await getSpecContextChunks(question)
    expect(mocks.getLatestStudySpec).toHaveBeenCalledWith(expect.objectContaining({ approvedOnly: true }))
  })

  it('con solo un borrador, el asistente no recibe nada del protocolo extraído', async () => {
    store({ approved: null, latest: row('draft') })
    expect(await getSpecContextChunks(question)).toEqual({ chunks: [], specFound: false })
  })

  it('con uno aprobado, lo recibe y sin la marca de borrador', async () => {
    store({ approved: row('approved'), latest: row('approved') })
    const result = await getSpecContextChunks(question)
    expect(result.specFound).toBe(true)
    expect(result.chunks.length).toBeGreaterThan(0)
    for (const chunk of result.chunks) expect(chunk.sectionTitle ?? '').not.toContain(UNAPPROVED_SPEC_TITLE_SUFFIX.trim())
    expect(result.chunks.map((chunk) => chunk.content).join('\n')).toContain('Edad de 18 años o más')
  })
})
