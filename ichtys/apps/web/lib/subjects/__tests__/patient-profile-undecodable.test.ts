import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

/**
 * Perfil guardado que ni siquiera llega a ser un objeto para validar: no tiene el formato del
 * cifrado o, descifrado, no es JSON. Antes eso era un error 500 sin aviso. Tiene que tratarse
 * igual que un perfil que no valida: al leer, vacío con la marca; al escribir, no se toca la
 * fila. Lo que es del entorno no es un problema de la fila y sigue saliendo como error: clave
 * ausente, clave mal formada, y también un texto que no descifra, porque con la clave correcta
 * eso casi no pasa y con la clave equivocada pasa en todas las filas a la vez.
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
import { PhiCryptoError, encryptPhiField } from '@ichtys/crypto'
import { PhiConfigError, encryptClinicalContent } from '../phi-fields'
import { loadPatientProfileState, ProfileUnreadableError, updatePatientProfile } from '../patient-profile-service'

const scope = { orgId: 'org-1', studyId: 'study-1', subjectId: 'subject-1' }
const audit = () => ({ action: 'profile.update' as const, orgId: 'org-1', studyId: 'study-1', userId: 'user_1', resourceType: 'subject', resourceId: 'subject-1', metadata: { source: 'test' } })
const keep = (current: PatientProfile) => current
const savedKey = process.env.PHI_ENCRYPTION_KEY
const KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)
const OTHER_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'.repeat(2)
const setRow = (profileEncrypted: string) => {
  store.row = { profileEncrypted, updatedAt: new Date('2026-11-14T10:00:00.000Z') }
}

const CLINICAL_TEXT = 'HbA1c 7,4 % y metformina 850 mg'
/** Cada caso: cómo queda la fila y qué motivo tiene que decir el registro. */
const cases = [
  ['un texto que no tiene el formato del cifrado', () => setRow(CLINICAL_TEXT), 'invalid_payload'],
  ['descifra, pero no es JSON', () => setRow(encryptClinicalContent(CLINICAL_TEXT)), 'not_json'],
] as const

let logged: MockInstance<typeof console.error>

beforeAll(() => {
  process.env.PHI_ENCRYPTION_KEY = KEY
})
afterAll(() => {
  if (savedKey === undefined) delete process.env.PHI_ENCRYPTION_KEY
  else process.env.PHI_ENCRYPTION_KEY = savedKey
})
beforeEach(() => {
  process.env.PHI_ENCRYPTION_KEY = KEY
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  logged.mockRestore()
})

describe('perfil guardado sin el formato del cifrado o que no es JSON', () => {
  it.each(cases)('%s — al leer: perfil vacío con la marca de ilegible, no un error', async (_label, arrange) => {
    arrange()
    const state = await loadPatientProfileState(scope)
    expect(state.unreadable).toBe(true)
    expect(state.profile.labs).toEqual([])
    expect(state.profile.conditions).toEqual([])
  })

  it.each(cases)('%s — al escribir: se rechaza como ilegible y la fila no se toca', async (_label, arrange) => {
    arrange()
    // El doble de la base tira si algo intenta escribir: que el rechazo sea este error prueba que no se llegó.
    await expect(updatePatientProfile(scope, keep, audit)).rejects.toBeInstanceOf(ProfileUnreadableError)
  })

  it.each(cases)('%s — queda un registro operativo con el motivo, sin ningún dato', async (_label, arrange, reason) => {
    for (const [operation, run] of [
      ['read', () => loadPatientProfileState(scope)],
      ['write', () => updatePatientProfile(scope, keep, audit).catch(() => undefined)],
    ] as const) {
      logged.mockClear()
      arrange()
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
            path: '(sin leer)',
            issueCode: reason,
            issueCount: 0,
          },
        ],
      ])
      const text = JSON.stringify(logged.mock.calls)
      for (const fragment of ['HbA1c', '7,4', 'metformina', '850', 'Diabetes']) expect(text).not.toContain(fragment)
    }
  })
})

describe('lo que es del entorno no se confunde con una fila rota', () => {
  const valid = () => setRow(encryptClinicalContent(JSON.stringify({ version: 1, conditions: [] })))

  it('sin clave de cifrado: sigue saliendo PhiConfigError, al leer y al escribir', async () => {
    valid()
    delete process.env.PHI_ENCRYPTION_KEY
    await expect(loadPatientProfileState(scope)).rejects.toBeInstanceOf(PhiConfigError)
    await expect(updatePatientProfile(scope, keep, audit)).rejects.toBeInstanceOf(PhiConfigError)
    expect(logged).not.toHaveBeenCalled()
  })

  it('cifrado con otra clave: error de configuración al leer y al escribir, con registro y sin ningún dato', async () => {
    for (const [operation, run] of [
      ['read', () => loadPatientProfileState(scope)],
      ['write', () => updatePatientProfile(scope, keep, audit)],
    ] as const) {
      logged.mockClear()
      setRow(encryptPhiField(JSON.stringify({ version: 1, conditions: ['Diabetes tipo 2'] }), OTHER_KEY))
      await expect(run()).rejects.toBeInstanceOf(PhiConfigError)
      expect(logged.mock.calls).toEqual([
        [
          '[patient-profile] stored_profile_undecryptable',
          { code: 'phi_decryption_failed', operation, orgId: 'org-1', studyId: 'study-1', subjectId: 'subject-1' },
        ],
      ])
      expect(JSON.stringify(logged.mock.calls)).not.toContain('Diabetes')
    }
  })

  it('con una clave mal formada: sale el error de configuración, no la marca de ilegible', async () => {
    valid()
    process.env.PHI_ENCRYPTION_KEY = 'no-es-una-clave'
    for (const run of [() => loadPatientProfileState(scope), () => updatePatientProfile(scope, keep, audit)]) {
      const err = await run().then(
        () => null,
        (e: unknown) => e,
      )
      expect(err).toBeInstanceOf(PhiCryptoError)
      expect((err as PhiCryptoError).code).toBe('invalid_key')
    }
    expect(logged).not.toHaveBeenCalled()
  })
})
