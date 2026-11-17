import { describe, expect, it, vi } from 'vitest'
import { PhiConfigError } from '../../subjects/phi-fields'
import {
  ChatSealRoundTripError,
  chatSealAuditEntry,
  planTextSeal,
  runChatSeal,
  type ChatSealBatchCount,
  type ChatSealOverviewRow,
  type ChatSealStore,
} from '../chat-seal'

/**
 * Sellado del chat anterior al cifrado: el texto en claro pasa a la columna cifrada y la
 * columna en claro queda vacía, sin cambiar el contenido y sin que ningún registro lo lleve.
 */
const enc = (text: string) => `cif(${text})`
const dec = (payload: string) => {
  const match = /^cif\((.*)\)$/s.exec(payload)
  if (!match) throw new Error('no abre')
  return match[1] as string
}
const TEXTO = 'Paciente con HbA1c 7,1 %'

describe('planTextSeal — qué se hace con cada texto', () => {
  it('sin nada en claro no hay nada que hacer', () => {
    expect(planTextSeal('message', { id: 'm1', plain: null, encrypted: enc('x') }, enc, dec)).toEqual({ action: 'none' })
  })

  it('un texto en claro se cifra, y lo cifrado abre al mismo texto', () => {
    const plan = planTextSeal('message', { id: 'm1', plain: TEXTO, encrypted: null }, enc, dec)
    expect(plan).toEqual({ action: 'seal', encrypted: enc(TEXTO) })
  })

  it('un texto vacío también se sella: sigue siendo el cuerpo del mensaje', () => {
    expect(planTextSeal('message', { id: 'm1', plain: '', encrypted: null }, enc, dec)).toEqual({ action: 'seal', encrypted: 'cif()' })
  })

  it('si lo cifrado no vuelve igual, tira sin llevar el texto en el error', () => {
    const torcido = () => enc('otra cosa')
    let caught: unknown
    try {
      planTextSeal('title', { id: 'c9', plain: TEXTO, encrypted: null }, torcido, dec)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ChatSealRoundTripError)
    expect((caught as Error).message).toContain('c9')
    expect((caught as Error).message).not.toContain('HbA1c')
  })

  it('si lo recién cifrado no abre, también es un error de ida y vuelta', () => {
    expect(() => planTextSeal('message', { id: 'm1', plain: TEXTO, encrypted: null }, () => 'basura', dec)).toThrow(ChatSealRoundTripError)
  })

  it('con las dos formas gana la cifrada: solo se vacía la columna en claro', () => {
    expect(planTextSeal('message', { id: 'm1', plain: TEXTO, encrypted: enc('versión cifrada') }, enc, dec)).toEqual({ action: 'clear_plain' })
  })

  it('con las dos formas y una cifrada que no abre, no se borra el único ejemplar legible', () => {
    expect(planTextSeal('message', { id: 'm1', plain: TEXTO, encrypted: 'basura' }, enc, dec)).toEqual({ action: 'blocked' })
  })

  it('sin clave no decide nada: deja pasar el error de configuración', () => {
    const sinClave = () => {
      throw new PhiConfigError('sin clave')
    }
    expect(() => planTextSeal('message', { id: 'm1', plain: TEXTO, encrypted: null }, sinClave, dec)).toThrow(PhiConfigError)
    expect(() => planTextSeal('message', { id: 'm1', plain: TEXTO, encrypted: enc('x') }, enc, sinClave)).toThrow(PhiConfigError)
  })
})

describe('chatSealAuditEntry — el registro de una tanda', () => {
  it('lleva cantidades y quién responde, nunca texto', () => {
    const entry = chatSealAuditEntry('org-a', { messages: 3, titles: 1, annotationsCleared: 2, blocked: 0 }, 'user_op')
    expect(entry).toMatchObject({ action: 'admin.action', orgId: 'org-a', userId: 'user_op', resourceType: 'messages' })
    expect(entry.metadata).toEqual({
      type: 'chat_encrypted_at_rest',
      messages: 3,
      titles: 1,
      annotationsCleared: 2,
      columns: ['messages.content', 'conversations.title', 'messages.annotations'],
      contentChanged: false,
      automated: true,
      humanConfirmed: false,
      operator: 'user_op',
    })
  })
})

/** Depósito de mentira: cada organización tiene pendientes y los va bajando por tanda. */
function fakeSystem(initial: Record<string, { messages: number; titles: number; annotations: number }>) {
  const state = structuredClone(initial)
  const audits: unknown[] = []
  const overview = async (): Promise<ChatSealOverviewRow[]> =>
    Object.entries(state).map(([organizationId, s]) => ({ organizationId, messages: 100, plainMessages: s.messages, plainTitles: s.titles, annotations: s.annotations }))
  const storeFor = (orgId: string): ChatSealStore => ({
    async sealBatch(limit, audit) {
      const s = state[orgId]!
      const count: ChatSealBatchCount = { messages: Math.min(limit, s.messages), titles: Math.min(limit, s.titles), annotationsCleared: Math.min(limit, s.annotations), blocked: 0 }
      s.messages -= count.messages
      s.titles -= count.titles
      s.annotations -= count.annotationsCleared
      if (count.messages + count.titles + count.annotationsCleared > 0) audits.push(audit(count))
      return count
    },
  })
  return { overview, storeFor, audits, state }
}
const okKey = { checkKey: () => 'ok' as const, probeKey: () => undefined }

describe('runChatSeal — el recorrido', () => {
  it('sella todas las organizaciones por tandas y termina en cero', async () => {
    const sys = fakeSystem({ 'org-a': { messages: 5, titles: 2, annotations: 3 }, 'org-b': { messages: 1, titles: 0, annotations: 0 }, 'org-c': { messages: 0, titles: 0, annotations: 0 } })
    const outcome = await runChatSeal({ overview: sys.overview, keySamples: async () => ['x'], storeFor: sys.storeFor }, { userId: 'user_op', batchSize: 2, budgetMs: 10_000, ...okKey })
    expect(outcome).toEqual({ status: 'done', organizations: 2, messages: 6, titles: 2, annotationsCleared: 3, batches: 4, remainingMessages: 0, remainingTitles: 0, remainingAnnotations: 0, blocked: 0 })
    expect(sys.audits).toHaveLength(4)
    expect(sys.audits.every((entry) => (entry as { userId: string }).userId === 'user_op')).toBe(true)
  })

  it('sin nada pendiente no comprueba la clave ni escribe', async () => {
    const sys = fakeSystem({ 'org-a': { messages: 0, titles: 0, annotations: 0 } })
    const probeKey = vi.fn()
    const outcome = await runChatSeal({ overview: sys.overview, keySamples: async () => [], storeFor: sys.storeFor }, { userId: 'u', batchSize: 2, budgetMs: 1000, checkKey: () => 'no_sample', probeKey })
    expect(outcome).toMatchObject({ status: 'done', batches: 0 })
    expect(probeKey).not.toHaveBeenCalled()
  })

  it('sin clave no escribe', async () => {
    const sys = fakeSystem({ 'org-a': { messages: 5, titles: 0, annotations: 0 } })
    const outcome = await runChatSeal(
      { overview: sys.overview, keySamples: async () => ['x'], storeFor: sys.storeFor },
      { userId: 'u', batchSize: 2, budgetMs: 1000, checkKey: () => 'ok', probeKey: () => { throw new PhiConfigError('sin clave') } },
    )
    expect(outcome).toEqual({ status: 'no_key' })
    expect(sys.state['org-a']!.messages).toBe(5)
  })

  it.each([['mismatch', 'key_mismatch'], ['no_sample', 'key_unverified']] as const)('si la clave da %s no escribe (%s)', async (check, status) => {
    const sys = fakeSystem({ 'org-a': { messages: 5, titles: 0, annotations: 0 } })
    const outcome = await runChatSeal({ overview: sys.overview, keySamples: async () => ['x'], storeFor: sys.storeFor }, { userId: 'u', batchSize: 2, budgetMs: 1000, checkKey: () => check, probeKey: () => undefined })
    expect(outcome).toEqual({ status })
    expect(sys.state['org-a']!.messages).toBe(5)
    expect(sys.audits).toHaveLength(0)
  })

  it('pasado el tope de tiempo no abre otra tanda y dice lo que falta', async () => {
    const sys = fakeSystem({ 'org-a': { messages: 6, titles: 0, annotations: 0 }, 'org-b': { messages: 4, titles: 0, annotations: 0 } })
    let clock = 0
    const outcome = await runChatSeal(
      { overview: sys.overview, keySamples: async () => ['x'], storeFor: sys.storeFor },
      { userId: 'u', batchSize: 2, budgetMs: 100, ...okKey, now: () => (clock += 30) },
    )
    expect(outcome).toMatchObject({ status: 'partial' })
    if (outcome.status !== 'partial') throw new Error('se esperaba partial')
    expect(outcome.remainingMessages).toBeGreaterThan(0)
    expect(outcome.messages + outcome.remainingMessages).toBe(10)
  })

  it('una tanda que solo encuentra filas bloqueadas corta esa organización y lo informa', async () => {
    const overview = async (): Promise<ChatSealOverviewRow[]> => [{ organizationId: 'org-a', messages: 3, plainMessages: 3, plainTitles: 0, annotations: 0 }]
    const sealBatch = vi.fn(async () => ({ messages: 0, titles: 0, annotationsCleared: 0, blocked: 3 }))
    const outcome = await runChatSeal({ overview, keySamples: async () => ['x'], storeFor: () => ({ sealBatch }) }, { userId: 'u', batchSize: 2, budgetMs: 1000, ...okKey })
    expect(sealBatch).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({ status: 'partial', blocked: 3, remainingMessages: 3, batches: 0, organizations: 0 })
  })
})
