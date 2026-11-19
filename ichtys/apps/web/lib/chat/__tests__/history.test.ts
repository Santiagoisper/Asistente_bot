/**
 * Lecturas del historial del chat (auditoría 19/11, H-09): cada consulta filtra por
 * organización, estudio (y persona, en la lista) en la base, no en memoria; el contenido
 * sale descifrado por persistence; las anotaciones se recalculan solo para el asistente.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  conversations: vi.fn(),
  messages: vi.fn(),
  citations: vi.fn(),
  annotate: vi.fn(() => [{ code: 'A1' }]),
}))

vi.mock('@ichtys/db', () => ({
  db: { query: { conversations: { findMany: h.conversations }, messages: { findMany: h.messages }, citations: { findMany: h.citations } } },
}))
vi.mock('@ichtys/rag/medical-annotator', () => ({ annotateAnswerSync: h.annotate }))
vi.mock('../persistence', () => ({
  readConversationTitle: (row: { titleEncrypted: string | null }) => (row.titleEncrypted ? `claro(${row.titleEncrypted})` : null),
  readMessageContent: (row: { contentEncrypted: string }) => `claro(${row.contentEncrypted})`,
}))

import { getConversationMessages, getMessageCitations, listConversationsForStudy } from '../history'

/** Evalúa el `where` de Drizzle con operadores que dicen qué se comparó. */
function whereOf(call: { where: (t: Record<string, string>, ops: Record<string, unknown>) => unknown }): unknown {
  const table = new Proxy({}, { get: (_t, key) => String(key) }) as Record<string, string>
  return call.where(table, { and: (...c: unknown[]) => c, eq: (col: string, val: unknown) => `${col}=${String(val)}` })
}
function orderOf(call: { orderBy: (t: Record<string, string>, ops: Record<string, unknown>) => unknown }): unknown {
  const table = new Proxy({}, { get: (_t, key) => String(key) }) as Record<string, string>
  return call.orderBy(table, { asc: (c: string) => `asc:${c}`, desc: (c: string) => `desc:${c}` })
}

const at = new Date('2026-11-19T10:00:00Z')

beforeEach(() => vi.clearAllMocks())

describe('listConversationsForStudy', () => {
  it('filtra por organización, estudio y persona, de la más reciente a la más vieja', async () => {
    h.conversations.mockResolvedValue([{ id: 'c1', studyId: 's1', titleEncrypted: 'T', createdAt: at, updatedAt: at }])
    const list = await listConversationsForStudy('org-1', 's1', 'user-1')
    const call = h.conversations.mock.calls[0]![0]
    expect(whereOf(call)).toEqual(['organizationId=org-1', 'studyId=s1', 'userId=user-1'])
    expect(orderOf(call)).toBe('desc:updatedAt')
    expect(list).toEqual([{ conversationId: 'c1', studyId: 's1', title: 'claro(T)', createdAt: at.toISOString(), updatedAt: at.toISOString() }])
  })
  it('sin título cifrado: null, no una cadena vacía', async () => {
    h.conversations.mockResolvedValue([{ id: 'c1', studyId: 's1', titleEncrypted: null, createdAt: at, updatedAt: at }])
    expect((await listConversationsForStudy('o', 's', 'u'))[0]!.title).toBeNull()
  })
})

describe('getConversationMessages', () => {
  it('filtra por conversación, organización y estudio; orden ascendente', async () => {
    h.messages.mockResolvedValue([])
    await getConversationMessages('conv-1', 'org-1', 's1')
    const call = h.messages.mock.calls[0]![0]
    expect(whereOf(call)).toEqual(['conversationId=conv-1', 'organizationId=org-1', 'studyId=s1'])
    expect(orderOf(call)).toBe('asc:createdAt')
  })
  it('descifra el contenido y anota solo las respuestas del asistente', async () => {
    h.messages.mockResolvedValue([
      { id: 'm1', role: 'user', contentEncrypted: 'pregunta', confidence: null, createdAt: at },
      { id: 'm2', role: 'assistant', contentEncrypted: 'respuesta', confidence: 'high', createdAt: at },
    ])
    const [user, assistant] = await getConversationMessages('conv-1', 'org-1', 's1')
    expect(user).toEqual({ messageId: 'm1', role: 'user', content: 'claro(pregunta)', confidence: null, createdAt: at.toISOString() })
    expect(assistant).toMatchObject({ content: 'claro(respuesta)', confidence: 'high', annotations: [{ code: 'A1' }] })
    expect(h.annotate).toHaveBeenCalledTimes(1)
    expect(h.annotate).toHaveBeenCalledWith('claro(respuesta)')
  })
})

describe('getMessageCitations', () => {
  it('filtra por mensaje, organización y estudio, y devuelve solo los campos conocidos', async () => {
    h.citations.mockResolvedValue([
      { id: 'ci1', citationIndex: 1, chunkId: 'ch', documentId: 'd', documentVersionId: 'v', documentName: 'P', documentType: 'protocol', pageStart: 3, pageEnd: 4, sectionTitle: null, excerpt: 'texto', embedding: [0.1], organizationId: 'org-1' },
    ])
    const out = await getMessageCitations('m2', 'org-1', 's1')
    expect(whereOf(h.citations.mock.calls[0]![0])).toEqual(['messageId=m2', 'organizationId=org-1', 'studyId=s1'])
    expect(out[0]).toEqual({ citationId: 'ci1', citationIndex: 1, chunkId: 'ch', documentId: 'd', documentVersionId: 'v', documentName: 'P', documentType: 'protocol', pageStart: 3, pageEnd: 4, sectionTitle: null, excerpt: 'texto' })
    expect(Object.keys(out[0]!)).not.toContain('embedding')
  })
})
