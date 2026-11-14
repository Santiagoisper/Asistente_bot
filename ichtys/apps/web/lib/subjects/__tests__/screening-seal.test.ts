import { encryptPhiField } from '@ichtys/crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PhiConfigError } from '../phi-fields'
import { isSealedScreeningJson, openScreeningJson, sealScreeningJson } from '../screening-crypto'
import {
  ScreeningSealRoundTripError,
  checkKeyAgainstStored,
  countRowsByOrg,
  databaseHostOf,
  planRowSeal,
  screeningColumnState,
  sealAuditEntry,
} from '../screening-seal'

/**
 * C3, lo anterior al cifrado: sellar las filas de `screening_assessments` que quedaron en
 * claro. La lógica que decide qué se escribe en cada fila está acá y no en el script, para
 * poder probarla sin base.
 */
const KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)
const OTHER_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'.repeat(2)
const savedKey = process.env.PHI_ENCRYPTION_KEY
const ASSESSMENTS = [
  { criterionNumber: '3', criterionText: 'HbA1c 7,0–10,5 %', kind: 'inclusion', status: 'pass', reason: 'HbA1c 7,9 % ≥ 7,0 % (mínimo inclusivo)', sourcePages: [12] },
]
const SUMMARY = { pass: 1, fail: 0, unknown: 0 }
const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  process.env.PHI_ENCRYPTION_KEY = KEY
})
afterAll(() => {
  if (savedKey === undefined) delete process.env.PHI_ENCRYPTION_KEY
  else process.env.PHI_ENCRYPTION_KEY = savedKey
})

describe('screeningColumnState — qué hay guardado en una columna', () => {
  it('la lista y el resumen anteriores al cifrado están en claro', () => {
    expect(screeningColumnState(ASSESSMENTS)).toBe('plain')
    expect(screeningColumnState(SUMMARY)).toBe('plain')
  })

  it('un sobre de esta versión ya está sellado', () => {
    expect(screeningColumnState(sealScreeningJson(SUMMARY))).toBe('sealed')
  })

  it('un sobre con otra marca no es ni una cosa ni la otra: no se envuelve de nuevo', () => {
    expect(screeningColumnState({ enc: 'phi.v9', ciphertext: 'x' })).toBe('foreign_envelope')
    expect(screeningColumnState({ enc: 'phi.v1', ciphertext: 42 })).toBe('foreign_envelope')
  })
})

describe('planRowSeal — qué se escribe en una fila', () => {
  const row = (assessments: unknown, summary: unknown) => ({ id: 'fila-1', organizationId: ORG_A, assessments, summary })

  it('una fila en claro: se sellan las dos columnas y al abrirlas vuelve lo mismo', () => {
    const plan = planRowSeal(row(ASSESSMENTS, SUMMARY))
    expect(Object.keys(plan.set).sort()).toEqual(['assessments', 'summary'])
    expect(plan.foreign).toEqual([])
    expect(isSealedScreeningJson(plan.set.assessments)).toBe(true)
    expect(JSON.stringify(plan.set)).not.toContain('HbA1c')
    expect(openScreeningJson(plan.set.assessments)).toEqual({ ok: true, value: ASSESSMENTS })
    expect(openScreeningJson(plan.set.summary)).toEqual({ ok: true, value: SUMMARY })
  })

  it('una fila ya sellada no se toca: correrlo dos veces no cambia nada', () => {
    const plan = planRowSeal(row(sealScreeningJson(ASSESSMENTS), sealScreeningJson(SUMMARY)))
    expect(plan).toEqual({ set: {}, foreign: [] })
  })

  it('una fila a medias: se sella solo la columna que estaba en claro', () => {
    const plan = planRowSeal(row(sealScreeningJson(ASSESSMENTS), SUMMARY))
    expect(Object.keys(plan.set)).toEqual(['summary'])
  })

  it('una columna con un sobre de otra marca se deja como está y se informa', () => {
    const plan = planRowSeal(row({ enc: 'phi.v9', ciphertext: 'x' }, SUMMARY))
    expect(Object.keys(plan.set)).toEqual(['summary'])
    expect(plan.foreign).toEqual(['assessments'])
  })

  it('si lo sellado no vuelve igual al abrirlo, corta: la tanda no se escribe', () => {
    const seal = (value: unknown) => sealScreeningJson(Array.isArray(value) ? [] : value)
    expect(() => planRowSeal(row(ASSESSMENTS, SUMMARY), seal)).toThrow(ScreeningSealRoundTripError)
  })

  it('si lo sellado no se puede abrir, corta', () => {
    const seal = () => ({ enc: 'phi.v1' as const, ciphertext: 'no-es-un-cifrado' })
    expect(() => planRowSeal(row(ASSESSMENTS, SUMMARY), seal)).toThrow(ScreeningSealRoundTripError)
  })

  it('el error de ida y vuelta nombra la fila y la columna, y nada del contenido', () => {
    const seal = (value: unknown) => sealScreeningJson(Array.isArray(value) ? [] : value)
    let caught: unknown
    try {
      planRowSeal(row(ASSESSMENTS, SUMMARY), seal)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ScreeningSealRoundTripError)
    const error = caught as ScreeningSealRoundTripError
    expect(error.rowId).toBe('fila-1')
    expect(error.column).toBe('assessments')
    expect(error.message).not.toContain('HbA1c')
  })

  it('compara contenido, no el orden de las claves: lo mismo con las claves en otro orden es igual', () => {
    const open = (stored: unknown) => {
      const opened = openScreeningJson(stored)
      if (!opened.ok || Array.isArray(opened.value)) return opened
      const reversed = Object.fromEntries(Object.entries(opened.value as Record<string, unknown>).reverse())
      return { ok: true as const, value: reversed }
    }
    expect(() => planRowSeal(row(ASSESSMENTS, SUMMARY), sealScreeningJson, open)).not.toThrow()
  })

  it('sin clave de cifrado sale como error de configuración, no como fila rota', () => {
    delete process.env.PHI_ENCRYPTION_KEY
    expect(() => planRowSeal(row(ASSESSMENTS, SUMMARY))).toThrow(PhiConfigError)
  })
})

describe('checkKeyAgainstStored — la clave de la corrida es la de esa base', () => {
  it('una muestra que descifra: la clave es la misma', () => {
    expect(checkKeyAgainstStored([encryptPhiField('{}')])).toBe('ok')
  })

  it('una muestra cifrada con otra clave: no se sella nada con esta', () => {
    process.env.PHI_ENCRYPTION_KEY = OTHER_KEY
    const foreign = encryptPhiField('{}')
    process.env.PHI_ENCRYPTION_KEY = KEY
    expect(checkKeyAgainstStored([encryptPhiField('{}'), foreign])).toBe('mismatch')
  })

  it('sin muestras, o con muestras que no son un cifrado, no hay con qué comprobar', () => {
    expect(checkKeyAgainstStored([])).toBe('no_sample')
    expect(checkKeyAgainstStored(['no-es-un-cifrado'])).toBe('no_sample')
  })

  it('sin clave sale como error de configuración', () => {
    const sample = encryptPhiField('{}')
    delete process.env.PHI_ENCRYPTION_KEY
    expect(() => checkKeyAgainstStored([sample])).toThrow(PhiConfigError)
  })
})

describe('auditoría de la tanda', () => {
  it('cuenta las filas por organización', () => {
    const counts = countRowsByOrg([{ organizationId: ORG_A }, { organizationId: ORG_B }, { organizationId: ORG_A }])
    expect(counts).toEqual([
      { organizationId: ORG_A, rows: 2 },
      { organizationId: ORG_B, rows: 1 },
    ])
  })

  it('el registro dice que se cifró, que el contenido no cambió y quién responde; no lleva contenido', () => {
    const entry = sealAuditEntry({ organizationId: ORG_A, rows: 2 }, 'user_operador')
    expect(entry.action).toBe('admin.action')
    expect(entry.orgId).toBe(ORG_A)
    expect(entry.userId).toBe('user_operador')
    expect(entry.resourceType).toBe('screening_assessments')
    expect(entry.metadata).toEqual({
      type: 'screening_assessments_encrypted_at_rest',
      rows: 2,
      columns: ['assessments', 'summary'],
      envelope: 'phi.v1',
      contentChanged: false,
      automated: true,
      humanConfirmed: false,
      operator: 'user_operador',
    })
  })
})

describe('databaseHostOf — a qué base apunta la corrida', () => {
  it('devuelve solo el host: ni usuario, ni contraseña, ni nombre de la base', () => {
    const host = databaseHostOf('postgresql://operador:secreto@ep-prueba-123.sa-east-1.aws.neon.tech/neondb?sslmode=require')
    expect(host).toBe('ep-prueba-123.sa-east-1.aws.neon.tech')
  })

  it('sin dirección, o con algo que no es una dirección, no hay host que confirmar', () => {
    expect(databaseHostOf(undefined)).toBeNull()
    expect(databaseHostOf('')).toBeNull()
    expect(databaseHostOf('no es una dirección')).toBeNull()
  })

  it('compara en minúsculas, como se escribe un host', () => {
    expect(databaseHostOf('postgres://u:p@EP-Prueba.Neon.Tech/db')).toBe('ep-prueba.neon.tech')
  })
})
