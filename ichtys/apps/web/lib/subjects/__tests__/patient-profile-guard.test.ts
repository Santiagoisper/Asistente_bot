import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Guarda de escritura del perfil. Misma base en memoria que la prueba de escritura
 * simultánea: una sola fila, y se cuenta cada escritura y cada registro de auditoría.
 */
const store = vi.hoisted(() => ({
  row: null as null | { profileEncrypted: string; updatedAt: Date },
  interleave: null as null | (() => void),
  writes: 0,
  enforce: true,
  audits: [] as Array<Record<string, unknown>>,
  failAudit: false,
  looseWrites: 0,
}))

vi.mock('@ichtys/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ichtys/db')>()
  const update = (via: 'db' | 'tx') => () => ({
      set: (values: { profileEncrypted: string; updatedAt: Date }) => ({
        where: (condition: unknown) => {
          const run = async () => {
            const expected = (condition as { __expected?: Date } | undefined)?.__expected
            const pending = store.interleave
            store.interleave = null
            pending?.()
            if (!store.row) return []
            // La base solo escribe si la fila sigue como se la leyó.
            if (store.enforce && expected && store.row.updatedAt.getTime() !== expected.getTime()) return []
            store.row = { profileEncrypted: values.profileEncrypted, updatedAt: values.updatedAt }
            store.writes += 1
            if (via === 'db') store.looseWrites += 1
            return [{ subjectId: 'subject-1' }]
          }
          return { returning: run }
        },
      }),
    })
  // La transacción: por acá entran el perfil y su registro de auditoría.
  const tx = {
    update: update('tx'),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (table !== original.auditLogs) throw new Error('unexpected table')
        if (store.failAudit) throw new Error('audit insert failed')
        store.audits.push(values)
      },
    }),
  }
  const db = {
    transaction: async <T,>(work: (handle: typeof tx) => Promise<T>) => work(tx),
    query: { patientProfiles: { findFirst: async () => (store.row ? { ...store.row } : undefined) } },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (store.row ? [{ ...store.row }] : []) }) }) }),
    update: update('db'),
  }
  return { ...original, db }
})

// La condición "la fila sigue como la leí" se marca para que la base en memoria la pueda evaluar.
vi.mock('../profile-version', () => ({
  whereProfileUnchanged: (_scope: unknown, expected: Date) => ({ __expected: expected }),
  nextVersion: (previous: Date) => new Date(Math.max(Date.now(), previous.getTime() + 1)),
}))

import { type PatientProfile } from '@ichtys/clinical'
import { decryptProfileJson, encryptClinicalContent, encryptProfileJson } from '../phi-fields'
import { ProfileInvalidError, ProfileUnreadableError, updatePatientProfile } from '../patient-profile-service'

const scope = { orgId: 'org-1', studyId: 'study-1', subjectId: 'subject-1' }
const audit = (next: PatientProfile) => ({ action: 'profile.update' as const, orgId: 'org-1', studyId: 'study-1', userId: 'user_1', resourceType: 'subject', resourceId: 'subject-1', metadata: { source: 'test', labCount: next.labs.length } })
const savedKey = process.env.PHI_ENCRYPTION_KEY
const at = new Date('2026-11-13T10:00:00.000Z')
const storeJson = (value: unknown) => {
  store.row = { profileEncrypted: encryptClinicalContent(JSON.stringify(value)), updatedAt: at }
}
const addGlucose = (current: PatientProfile): PatientProfile => ({ ...current, labs: [...current.labs, { name: 'Glucosa', value: 92, unit: 'mg/dL' }] })

/** Un perfil con datos cargados y un solo dato mal formado: el valor de un laboratorio guardado como texto. */
const damaged = {
  version: 1,
  labs: [{ name: 'HbA1c', value: 7.4, unit: '%' }, { name: 'Creatinina', value: 'cero coma nueve', unit: 'mg/dL' }],
  medications: [{ name: 'metformina' }],
  conditions: ['Sin antecedente de pancreatitis'],
}

beforeAll(() => {
  process.env.PHI_ENCRYPTION_KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)
})
afterAll(() => {
  if (savedKey === undefined) delete process.env.PHI_ENCRYPTION_KEY
  else process.env.PHI_ENCRYPTION_KEY = savedKey
})
beforeEach(() => {
  store.interleave = null
  store.writes = 0
  store.enforce = true
  store.audits.length = 0
  store.failAudit = false
  store.looseWrites = 0
})

describe('perfil del sujeto — un perfil que no se pudo leer no se pisa', () => {
  it.each([
    ['un valor de laboratorio guardado como texto', damaged],
    ['una versión que este código no conoce', { version: 2, labs: [{ name: 'HbA1c', value: 7.4, unit: '%' }] }],
    ['una lista de condiciones que no es una lista', { version: 1, conditions: 'Sin antecedente de pancreatitis' }],
    ['una lista en lugar de un perfil', [{ name: 'HbA1c', value: 7.4, unit: '%' }]],
    ['un texto en lugar de un perfil', 'perfil'],
  ])('con %s: avisa, no aplica el cambio y deja la fila como estaba', async (_label, value) => {
    storeJson(value)
    const before = store.row!.profileEncrypted
    let mutateCalls = 0
    const result = updatePatientProfile(scope, (current) => {
      mutateCalls += 1
      return addGlucose(current)
    }, audit)
    await expect(result).rejects.toBeInstanceOf(ProfileUnreadableError)
    expect(mutateCalls).toBe(0)
    expect(store.row!.profileEncrypted).toBe(before)
    expect(store.row!.updatedAt).toEqual(at)
    expect(store.writes).toBe(0)
    expect(store.audits).toEqual([])
  })

  it('el aviso no repite ningún dato del perfil', async () => {
    storeJson(damaged)
    const error = await updatePatientProfile(scope, addGlucose, audit).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(ProfileUnreadableError)
    const text = `${(error as Error).message} ${JSON.stringify(error)}`
    for (const fragment of ['HbA1c', '7.4', 'Creatinina', 'cero coma nueve', 'metformina', 'pancreatitis']) expect(text).not.toContain(fragment)
  })

  it('un sujeto recién creado (perfil guardado como {}) se sigue pudiendo escribir', async () => {
    storeJson({})
    const result = await updatePatientProfile(scope, addGlucose, audit)
    expect(result.labs).toEqual([{ name: 'Glucosa', value: 92, unit: 'mg/dL' }])
    expect(decryptProfileJson(store.row!.profileEncrypted)).toMatchObject({ version: 1, labs: [{ name: 'Glucosa', value: 92, unit: 'mg/dL' }] })
    expect(store.writes).toBe(1)
    expect(store.audits).toHaveLength(1)
  })
})

describe('perfil del sujeto — lo que se va a guardar tiene que ser un perfil válido', () => {
  it.each([
    ['un valor de laboratorio que no es un número', (current: PatientProfile) => ({ ...current, labs: [...current.labs, { name: 'Creatinina', value: 'cero coma nueve', unit: 'mg/dL' }] }) as unknown as PatientProfile],
    ['una edad negativa', (current: PatientProfile) => ({ ...current, demographics: { ageYears: -4 } })],
    ['una versión que este código no conoce', (current: PatientProfile) => ({ ...current, version: 2 }) as unknown as PatientProfile],
  ])('con %s: avisa y no guarda nada', async (_label, mutate) => {
    store.row = { profileEncrypted: encryptProfileJson({ version: 1, labs: [{ name: 'HbA1c', value: 7.4, unit: '%' }], medications: [], conditions: [] }), updatedAt: at }
    const before = store.row.profileEncrypted
    await expect(updatePatientProfile(scope, mutate, audit)).rejects.toBeInstanceOf(ProfileInvalidError)
    expect(store.row!.profileEncrypted).toBe(before)
    expect(store.row!.updatedAt).toEqual(at)
    expect(store.writes).toBe(0)
    expect(store.audits).toEqual([])
  })

  it('un cambio válido sobre un perfil con datos se guarda como siempre', async () => {
    store.row = { profileEncrypted: encryptProfileJson({ version: 1, labs: [{ name: 'HbA1c', value: 7.4, unit: '%' }], medications: [], conditions: [] }), updatedAt: at }
    const result = await updatePatientProfile(scope, addGlucose, audit)
    expect(result.labs.map((entry) => entry.name)).toEqual(['HbA1c', 'Glucosa'])
    expect((decryptProfileJson(store.row!.profileEncrypted) as { labs: Array<{ name: string }> }).labs.map((entry) => entry.name)).toEqual(['HbA1c', 'Glucosa'])
    expect(store.writes).toBe(1)
    expect(store.audits).toEqual([expect.objectContaining({ action: 'profile.update', metadata: { source: 'test', labCount: 2 } })])
  })
})
