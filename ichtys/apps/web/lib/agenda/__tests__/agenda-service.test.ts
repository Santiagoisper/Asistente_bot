import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  subjects: [] as Array<Record<string, unknown>>,
  studies: [] as Array<Record<string, unknown>>,
  items: [] as Array<Record<string, unknown>>,
  subjectQueries: 0,
  lastSet: null as Record<string, unknown> | null,
  updateHits: true,
}))

vi.mock('@ichtys/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ichtys/db')>()
  const rowsOf = (table: unknown) => (table === original.subjects ? store.subjects : table === original.studies ? store.studies : store.items)
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === original.subjects) store.subjectQueries += 1
          const rows = rowsOf(table)
          return Object.assign(Promise.resolve(rows), { limit: async () => rows, orderBy: () => ({ limit: async () => rows }) })
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        store.items.push({ id: 'item-1', status: 'scheduled', ...values })
        return { returning: async () => [{ id: 'item-1' }] }
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        store.lastSet = values
        return { where: () => ({ returning: async () => (store.updateHits ? [{ id: 'item-1', status: (values.status as string | undefined) ?? 'scheduled' }] : []) }) }
      },
    }),
  }
  return { ...original, db }
})

import { AgendaError, createAgendaItem, listAgenda, updateAgendaItem } from '../agenda-service'

const BA = 'America/Argentina/Buenos_Aires'
const scope = { orgId: 'org-1', studyId: 'study-1', userId: 'user_1', timeZone: BA }
const input = { subjectId: 'subj-1', title: 'Visita 3', kind: 'visit' as const, day: '2026-11-16', time: '09:30', durationMinutes: 30, notes: 'Viene en ayunas' }
const savedKey = process.env.PHI_ENCRYPTION_KEY

beforeAll(() => {
  process.env.PHI_ENCRYPTION_KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)
})
afterAll(() => {
  if (savedKey === undefined) delete process.env.PHI_ENCRYPTION_KEY
  else process.env.PHI_ENCRYPTION_KEY = savedKey
})
beforeEach(() => {
  store.subjects = [{ id: 'subj-1', subjectCode: '001-001' }]
  store.studies = [{ id: 'study-1', name: 'Estudio metabólico', protocolNumber: 'PROTO-2' }]
  store.items = []
  store.subjectQueries = 0
  store.lastSet = null
  store.updateHits = true
})

describe('agenda — alta de un turno', () => {
  it('guarda el instante que corresponde a la hora del sitio y las notas cifradas', async () => {
    await createAgendaItem({ ...scope, input })
    const saved = store.items[0]!
    expect(saved).toMatchObject({ organizationId: 'org-1', studyId: 'study-1', subjectId: 'subj-1', title: 'Visita 3', kind: 'visit', durationMinutes: 30, createdBy: 'user_1' })
    expect((saved.startsAt as Date).toISOString()).toBe('2026-11-16T12:30:00.000Z')
    expect(String(saved.notesEncrypted)).not.toContain('ayunas')
  })

  it('un sujeto que no es de ese estudio y esa organización no se agenda', async () => {
    store.subjects = []
    await expect(createAgendaItem({ ...scope, input })).rejects.toMatchObject({ code: 'subject_mismatch' })
    expect(store.items).toHaveLength(0)
  })

  it('sin sujeto no consulta sujetos y guarda las notas vacías como null', async () => {
    await createAgendaItem({ ...scope, input: { ...input, subjectId: null, notes: null, kind: 'monitoring' } })
    expect(store.subjectQueries).toBe(0)
    expect(store.items[0]).toMatchObject({ subjectId: null, notesEncrypted: null })
  })
})

describe('agenda — cambio de un turno', () => {
  it('cambia el estado y deja quién y cuándo', async () => {
    const updated = await updateAgendaItem({ ...scope, itemId: 'item-1', patch: { status: 'done' } })
    expect(updated.status).toBe('done')
    expect(store.lastSet).toMatchObject({ status: 'done', updatedBy: 'user_1' })
    expect(store.lastSet).not.toHaveProperty('startsAt')
  })

  it('reprogramar mueve el instante y vuelve a dejar el turno programado', async () => {
    await updateAgendaItem({ ...scope, itemId: 'item-1', patch: { day: '2026-11-18', time: '15:00' } })
    expect((store.lastSet!.startsAt as Date).toISOString()).toBe('2026-11-18T18:00:00.000Z')
    expect(store.lastSet).toMatchObject({ status: 'scheduled' })
  })

  it('un turno de otro estudio u otra organización no existe', async () => {
    store.updateHits = false
    await expect(updateAgendaItem({ ...scope, itemId: 'item-1', patch: { status: 'cancelled' } })).rejects.toBeInstanceOf(AgendaError)
  })
})

describe('agenda — listado', () => {
  const range = { orgId: 'org-1', scope: { kind: 'all' as const }, from: new Date('2026-11-16T03:00:00Z'), to: new Date('2026-11-17T03:00:00Z') }

  it('quien puede ver sujetos recibe el código y las notas descifradas', async () => {
    await createAgendaItem({ ...scope, input })
    const [entry] = await listAgenda({ ...range, includeSubjects: true })
    expect(entry).toMatchObject({ studyLabel: 'PROTO-2', subjectCode: '001-001', notes: 'Viene en ayunas', title: 'Visita 3' })
  })

  it('quien no puede ver sujetos no recibe código, id de sujeto ni notas, y no se consultan sujetos', async () => {
    await createAgendaItem({ ...scope, input })
    store.subjectQueries = 0
    const [entry] = await listAgenda({ ...range, includeSubjects: false })
    expect(entry).toMatchObject({ subjectId: null, subjectCode: null, notes: null, title: 'Visita 3' })
    expect(store.subjectQueries).toBe(0)
  })

  it('una nota que no se puede descifrar no tira la agenda', async () => {
    store.items = [{ id: 'item-9', studyId: 'study-1', subjectId: null, title: 'Monitoreo', kind: 'monitoring', startsAt: new Date('2026-11-16T12:00:00Z'), durationMinutes: 60, status: 'scheduled', notesEncrypted: 'basura' }]
    const [entry] = await listAgenda({ ...range, includeSubjects: true })
    expect(entry).toMatchObject({ title: 'Monitoreo', notes: null })
  })

  it('sin turnos no consulta nada más', async () => {
    expect(await listAgenda({ ...range, includeSubjects: true })).toEqual([])
  })
})
