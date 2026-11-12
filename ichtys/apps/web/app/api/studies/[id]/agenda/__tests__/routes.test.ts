import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockAccessError extends Error {
    constructor(message: string, readonly status: 401 | 403 | 404) {
      super(message)
    }
  }
  class MockAgendaError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  return { AccessError: MockAccessError, AgendaError: MockAgendaError, validatePhiStudyAccess: vi.fn(), writeAuditLog: vi.fn(), tx: { transaction: 'tx' }, createAgendaItem: vi.fn(), updateAgendaItem: vi.fn() }
})

vi.mock('@ichtys/auth', () => ({
  validatePhiStudyAccess: mocks.validatePhiStudyAccess,
  handleApiError: (err: unknown) => (err instanceof mocks.AccessError ? new Response('denied', { status: err.status }) : new Response('error', { status: 500 })),
}))
vi.mock('../../../../../../lib/chat/persistence', () => ({ writeAuditLog: mocks.writeAuditLog }))
// La escritura y su auditoría van juntas (R3). Acá se simula el envoltorio: corre
// la escritura con la transacción y, solo si salió bien, asienta la auditoría.
// Que las dos entren de verdad en una transacción se prueba en lib/audit.
vi.mock('../../../../../../lib/audit/audited-write', () => ({
  auditedWrite: async <T,>(write: (tx: unknown) => Promise<T>, audit: (result: T) => unknown) => {
    const result = await write(mocks.tx)
    await mocks.writeAuditLog(audit(result))
    return result
  },
}))
vi.mock('../../../../../../lib/agenda/agenda-service', () => ({ AgendaError: mocks.AgendaError, createAgendaItem: mocks.createAgendaItem, updateAgendaItem: mocks.updateAgendaItem }))
vi.mock('../../../../../../lib/subjects/phi-fields', () => ({ PhiConfigError: class extends Error {} }))
vi.mock('../../../../../../lib/os/org-settings', () => ({ loadOrgTimeZone: async (orgId: string) => (orgId === 'org-bogota' ? 'America/Bogota' : 'America/Argentina/Buenos_Aires') }))

import { POST as create } from '../route'
import { PATCH as update } from '../[itemId]/route'

const STUDY = '11111111-1111-4111-8111-111111111111'
const SUBJECT = '22222222-2222-4222-8222-222222222222'
const ITEM = '44444444-4444-4444-8444-444444444444'
const ctx = { params: Promise.resolve({ id: STUDY }) }
const itemCtx = (itemId = ITEM) => ({ params: Promise.resolve({ id: STUDY, itemId }) })
const savedEnv = { vercel: process.env.VERCEL_ENV, os: process.env.ALPHI_OS }
const body = { subjectId: SUBJECT, title: 'Visita 3 de PEREZ', kind: 'visit', day: '2026-11-16', time: '09:30', durationMinutes: 30, notes: 'Viene en ayunas' }
const request = (method: string, payload: unknown) => new Request('https://os.example.test/agenda', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VERCEL_ENV = 'preview'
  mocks.validatePhiStudyAccess.mockResolvedValue({ userId: 'user_1', orgId: 'org-1', study: { id: STUDY } })
  mocks.createAgendaItem.mockResolvedValue({ id: ITEM })
  mocks.updateAgendaItem.mockResolvedValue({ id: ITEM, status: 'done' })
})
afterEach(() => {
  if (savedEnv.vercel === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = savedEnv.vercel
  if (savedEnv.os === undefined) delete process.env.ALPHI_OS
  else process.env.ALPHI_OS = savedEnv.os
})

describe('POST agenda — agendar un turno', () => {
  it('con el OS apagado en producción no existe', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.ALPHI_OS
    expect((await create(request('POST', body), ctx)).status).toBe(404)
    expect(mocks.validatePhiStudyAccess).not.toHaveBeenCalled()
  })

  it('sin permiso sobre el estudio no se crea nada', async () => {
    mocks.validatePhiStudyAccess.mockRejectedValue(new mocks.AccessError('Forbidden', 403))
    expect((await create(request('POST', body), ctx)).status).toBe(403)
    expect(mocks.createAgendaItem).not.toHaveBeenCalled()
  })

  it('éxito: 201 con la organización del token y el estudio de la URL; la auditoría no lleva título ni notas', async () => {
    const res = await create(request('POST', body), ctx)
    expect(res.status).toBe(201)
    expect(mocks.validatePhiStudyAccess).toHaveBeenCalledWith(STUDY, { require: 'agenda.manage' })
    expect(mocks.createAgendaItem).toHaveBeenCalledWith(expect.objectContaining({ executor: mocks.tx, orgId: 'org-1', studyId: STUDY, userId: 'user_1', timeZone: 'America/Argentina/Buenos_Aires' }))
    const audit = JSON.stringify(mocks.writeAuditLog.mock.calls[0]?.[0])
    expect(audit).toContain('agenda.create')
    expect(audit).not.toMatch(/PEREZ|ayunas/)
  })

  it('un cuerpo inválido o con la organización adentro: 400 sin tocar la base', async () => {
    for (const bad of [{ ...body, day: '2026-02-30' }, { ...body, organizationId: 'otra' }, { ...body, studyId: SUBJECT }, 'texto']) {
      expect((await create(request('POST', bad), ctx)).status).toBe(400)
    }
    expect(mocks.createAgendaItem).not.toHaveBeenCalled()
  })

  it('un sujeto de otro estudio: 400 con código estable y sin auditoría', async () => {
    mocks.createAgendaItem.mockRejectedValue(new mocks.AgendaError('subject_mismatch'))
    const res = await create(request('POST', body), ctx)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'subject_mismatch' })
    expect(mocks.writeAuditLog).not.toHaveBeenCalled()
  })
})

describe('PATCH agenda/[itemId] — cambiar un turno', () => {
  it('cambia el estado dentro del estudio de la URL y lo audita', async () => {
    const res = await update(request('PATCH', { status: 'done' }), itemCtx())
    expect(res.status).toBe(200)
    expect(mocks.updateAgendaItem).toHaveBeenCalledWith(expect.objectContaining({ executor: mocks.tx, orgId: 'org-1', studyId: STUDY, itemId: ITEM, patch: { status: 'done' } }))
    // Otro centro, otra hora: la zona sale de la organización del token.
    mocks.validatePhiStudyAccess.mockResolvedValue({ userId: 'user_2', orgId: 'org-bogota', study: { id: STUDY } })
    await update(request('PATCH', { status: 'done' }), itemCtx())
    expect(mocks.updateAgendaItem).toHaveBeenLastCalledWith(expect.objectContaining({ orgId: 'org-bogota', timeZone: 'America/Bogota' }))
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls[0]?.[0])).toContain('agenda.update')
  })

  it('sin permiso: 403; id que no es UUID o turno de otro estudio: 404; cambio inválido: 400', async () => {
    expect((await update(request('PATCH', { status: 'done' }), itemCtx('1; drop table'))).status).toBe(404)
    expect((await update(request('PATCH', { day: '2026-11-17' }), itemCtx())).status).toBe(400)
    expect(mocks.updateAgendaItem).not.toHaveBeenCalled()
    mocks.updateAgendaItem.mockRejectedValue(new mocks.AgendaError('not_found'))
    expect((await update(request('PATCH', { status: 'done' }), itemCtx())).status).toBe(404)
    mocks.validatePhiStudyAccess.mockRejectedValue(new mocks.AccessError('Forbidden', 403))
    expect((await update(request('PATCH', { status: 'done' }), itemCtx())).status).toBe(403)
  })
})
