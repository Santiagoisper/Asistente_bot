import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regla R3 (brecha C1) en el chat: el mensaje y su registro de auditoría se
 * confirman en la misma transacción. Antes la ruta guardaba el mensaje y
 * después auditaba como paso aparte.
 */
const state = vi.hoisted(() => ({
  writes: [] as Array<{ table: string; values: Record<string, unknown>; via: 'tx' | 'db' }>,
  transactions: 0,
  docs: [] as Array<{ id: string; name: string; documentType: string }>,
  failAudit: false,
}))

vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('@ichtys/llm', () => ({ runWithLlmFallback: vi.fn() }))
vi.mock('@ichtys/auth', () => ({ AccessError: class AccessError extends Error {}, logServerError: vi.fn() }))
vi.mock('@ichtys/db', () => {
  const insert = (via: 'tx' | 'db') => (table: { __name: string }) => ({
    values: (values: Record<string, unknown>) => {
      if (table.__name === 'audit_logs' && state.failAudit) {
        const failed = Promise.reject(new Error('audit unavailable'))
        return Object.assign(failed, { returning: () => failed })
      }
      state.writes.push({ table: table.__name, values, via })
      const done = Promise.resolve([{ id: `${table.__name}-id` }])
      return Object.assign(done, { returning: () => done })
    },
  })
  const tx = {
    insert: insert('tx'),
    select: () => ({ from: () => ({ where: async () => state.docs }) }),
  }
  return {
    and: (...parts: unknown[]) => parts,
    eq: (a: unknown, b: unknown) => [a, b],
    desc: (a: unknown) => a,
    inArray: (a: unknown, b: unknown) => [a, b],
    recordUsage: vi.fn(),
    auditLogs: { __name: 'audit_logs' },
    citations: { __name: 'citations' },
    conversations: { __name: 'conversations' },
    documents: { __name: 'documents', id: 'documents.id', organizationId: 'documents.organization_id' },
    messages: { __name: 'messages', id: 'messages.id' },
    db: {
      insert: insert('db'),
      transaction: async <T,>(run: (t: typeof tx) => Promise<T>) => {
        state.transactions += 1
        const before = state.writes.length
        try {
          return await run(tx)
        } catch (err) {
          // Una transacción que falla no deja nada escrito.
          state.writes.length = before
          throw err
        }
      },
    },
  }
})

const { persistAssistantMessageAndCitations, persistUserMessage } = await import('../persistence')

const audit = (action: 'rag.answer.requested' | 'rag.answer.completed') => ({
  action,
  orgId: 'org-1',
  studyId: 'study-1',
  userId: 'user-1',
  resourceType: 'conversation',
  resourceId: 'conv-1',
  metadata: { historyTurns: 0 },
})

beforeEach(() => {
  state.writes.length = 0
  state.transactions = 0
  state.docs = []
  state.failAudit = false
})

describe('chat — el mensaje y su registro van en la misma transacción', () => {
  it('mensaje del usuario: una transacción con el mensaje y el registro', async () => {
    const id = await persistUserMessage({ conversationId: 'conv-1', orgId: 'org-1', studyId: 'study-1', question: 'pregunta ficticia', audit: audit('rag.answer.requested') })

    expect(id).toBe('messages-id')
    expect(state.transactions).toBe(1)
    expect(state.writes.map((w) => `${w.via}:${w.table}`)).toEqual(['tx:messages', 'tx:audit_logs'])
    expect(state.writes[1]!.values).toMatchObject({ action: 'rag.answer.requested', organizationId: 'org-1', resourceId: 'conv-1' })
    // El registro no lleva el texto de la pregunta.
    expect(JSON.stringify(state.writes[1]!.values)).not.toContain('pregunta ficticia')
  })

  it('mensaje del usuario: si el registro falla, el mensaje no queda guardado', async () => {
    state.failAudit = true
    await expect(
      persistUserMessage({ conversationId: 'conv-1', orgId: 'org-1', studyId: 'study-1', question: 'pregunta ficticia', audit: audit('rag.answer.requested') }),
    ).rejects.toThrow('audit unavailable')
    expect(state.writes).toEqual([])
  })

  it('respuesta con citas: mensaje, citas y registro en una sola transacción', async () => {
    state.docs = [{ id: 'doc-1', name: 'Protocolo ficticio', documentType: 'protocol' }]
    const id = await persistAssistantMessageAndCitations({
      conversationId: 'conv-1',
      orgId: 'org-1',
      studyId: 'study-1',
      answer: 'respuesta ficticia',
      confidence: 'high' as never,
      evidences: [{ citationIndex: 1, chunkId: 'chunk-1', documentId: 'doc-1', documentVersionId: 'docv-1', pageStart: 3, pageEnd: 3, sectionTitle: null, excerpt: 'texto' } as never],
      audit: audit('rag.answer.completed'),
    })

    expect(id).toBe('messages-id')
    expect(state.transactions).toBe(1)
    expect(state.writes.map((w) => `${w.via}:${w.table}`)).toEqual(['tx:messages', 'tx:citations', 'tx:audit_logs'])
    expect(state.writes[2]!.values).toMatchObject({ action: 'rag.answer.completed' })
  })

  it('respuesta: si el registro falla, no quedan ni el mensaje ni las citas', async () => {
    state.failAudit = true
    await expect(
      persistAssistantMessageAndCitations({ conversationId: 'conv-1', orgId: 'org-1', studyId: 'study-1', answer: 'respuesta ficticia', confidence: 'high' as never, evidences: [], audit: audit('rag.answer.completed') }),
    ).rejects.toThrow('audit unavailable')
    expect(state.writes).toEqual([])
  })
})
