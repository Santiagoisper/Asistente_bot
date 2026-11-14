import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

/**
 * Registro operativo de un perfil guardado que no valida. La pantalla le dice a la persona
 * «avisá a soporte»; soporte necesita saber qué sujeto es y qué campo está roto, sin que el
 * registro lleve ningún dato del perfil.
 */
const store = vi.hoisted(() => ({ row: null as null | { profileEncrypted: string; updatedAt: Date } }))

vi.mock('@ichtys/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ichtys/db')>()
  const noWrite = () => {
    throw new Error('esta prueba no tiene que escribir en la base')
  }
  const db = {
    transaction: noWrite,
    update: noWrite,
    insert: noWrite,
    query: { patientProfiles: { findFirst: async () => (store.row ? { ...store.row } : undefined) } },
  }
  return { ...original, db }
})

import { type PatientProfile } from '@ichtys/clinical'
import { encryptClinicalContent } from '../phi-fields'
import { loadPatientProfileState, ProfileUnreadableError, updatePatientProfile } from '../patient-profile-service'

const scope = { orgId: 'org-1', studyId: 'study-1', subjectId: 'subject-1' }
const audit = () => ({ action: 'profile.update' as const, orgId: 'org-1', studyId: 'study-1', userId: 'user_1', resourceType: 'subject', resourceId: 'subject-1', metadata: { source: 'test' } })
const keep = (current: PatientProfile) => current
const savedKey = process.env.PHI_ENCRYPTION_KEY
const storeJson = (value: unknown) => {
  store.row = { profileEncrypted: encryptClinicalContent(JSON.stringify(value)), updatedAt: new Date('2026-11-13T10:00:00.000Z') }
}

/** Datos cargados y un solo dato mal formado: el valor de un laboratorio guardado como texto. */
const damaged = {
  version: 1,
  labs: [{ name: 'HbA1c', value: 7.4, unit: '%' }, { name: 'Creatinina', value: 'cero coma nueve', unit: 'mg/dL' }],
  medications: [{ name: 'metformina' }],
  conditions: ['Sin antecedente de pancreatitis'],
}
const clinicalFragments = ['HbA1c', '7.4', 'Creatinina', 'cero coma nueve', 'mg/dL', 'metformina', 'pancreatitis', 'Diabetes tipo 2', 'altísima']

const read = async () => {
  expect((await loadPatientProfileState(scope)).unreadable).toBe(true)
}
const write = async () => {
  await expect(updatePatientProfile(scope, keep, audit)).rejects.toBeInstanceOf(ProfileUnreadableError)
}

let logged: MockInstance<typeof console.error>

beforeAll(() => {
  process.env.PHI_ENCRYPTION_KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)
})
afterAll(() => {
  if (savedKey === undefined) delete process.env.PHI_ENCRYPTION_KEY
  else process.env.PHI_ENCRYPTION_KEY = savedKey
})
beforeEach(() => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  logged.mockRestore()
})

describe('perfil guardado que no valida — queda un registro operativo', () => {
  it.each([
    ['leer', 'read', read],
    ['escribir', 'write', write],
  ] as const)('al %s: un solo registro, con la organización, el estudio, el sujeto y la ruta exacta del dato', async (_label, operation, run) => {
    storeJson(damaged)
    await run()
    expect(logged.mock.calls).toEqual([
      [
        '[patient-profile] stored_profile_unreadable',
        {
          code: 'profile_unreadable',
          operation,
          orgId: 'org-1',
          studyId: 'study-1',
          subjectId: 'subject-1',
          path: 'labs[1].value',
          issueCode: 'invalid_type',
          issueCount: 1,
        },
      ],
    ])
  })

  it.each([
    ['una versión que este código no conoce', { version: 2, labs: [{ name: 'HbA1c', value: 7.4, unit: '%' }] }, 'version', 'invalid_value', 1],
    ['una lista de condiciones que no es una lista', { version: 1, conditions: 'Sin antecedente de pancreatitis' }, 'conditions', 'invalid_type', 1],
    ['una lista en lugar de un perfil', [{ name: 'HbA1c', value: 7.4, unit: '%' }], '(raíz)', 'invalid_type', 1],
    ['un texto en lugar de un perfil', 'perfil', '(raíz)', 'invalid_type', 1],
    ['la confianza de una condición', { version: 1, conditions: ['Diabetes tipo 2'], fieldConfidence: { conditions: { 'Diabetes tipo 2': 'altísima' } } }, 'fieldConfidence.conditions.*', 'invalid_value', 1],
    ['dos datos mal formados', { ...damaged, medications: [{ name: 'metformina' }, { dose: '850 mg' }] }, 'labs[1].value', 'invalid_type', 2],
  ])('con %s: la ruta y el motivo del primer dato, y cuántos fallaron', async (_label, value, path, issueCode, issueCount) => {
    for (const run of [read, write]) {
      logged.mockClear()
      storeJson(value)
      await run()
      expect(logged).toHaveBeenCalledTimes(1)
      expect(logged.mock.calls[0]![1]).toMatchObject({ path, issueCode, issueCount })
    }
  })

  it.each([
    ['un valor de laboratorio como texto', damaged],
    ['una clave de confianza que es el nombre de una condición', { ...damaged, labs: [], fieldConfidence: { conditions: { 'Diabetes tipo 2': 'altísima' } } }],
    ['una lista en lugar de un perfil', damaged.labs],
  ])('con %s: el registro no repite ningún dato del perfil', async (_label, value) => {
    for (const run of [read, write]) {
      logged.mockClear()
      storeJson(value)
      await run()
      expect(logged).toHaveBeenCalledTimes(1)
      const text = JSON.stringify(logged.mock.calls)
      for (const fragment of clinicalFragments) expect(text).not.toContain(fragment)
    }
  })
})

describe('perfil guardado que valida — no hay nada que registrar', () => {
  it.each([
    ['un perfil con datos', { version: 1, labs: [{ name: 'HbA1c', value: 7.4, unit: '%' }], medications: [], conditions: [] }],
    ['un sujeto recién creado (perfil guardado como {})', {}],
  ])('%s: leerlo no deja registro', async (_label, value) => {
    storeJson(value)
    expect((await loadPatientProfileState(scope)).unreadable).toBe(false)
    expect(logged).not.toHaveBeenCalled()
  })

  it('un sujeto sin fila de perfil: leerlo no deja registro', async () => {
    store.row = null
    expect((await loadPatientProfileState(scope)).unreadable).toBe(false)
    expect(logged).not.toHaveBeenCalled()
  })
})
