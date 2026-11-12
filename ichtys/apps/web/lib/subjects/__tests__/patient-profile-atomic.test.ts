import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Base en memoria con una sola fila de perfil. `interleave` permite meter una
 * escritura ajena justo entre la lectura y la escritura de quien se prueba:
 * es lo que pasa cuando dos personas trabajan sobre el mismo sujeto a la vez.
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

import { parsePatientProfile, type PatientProfile } from '@ichtys/clinical'
import { decryptProfileJson, encryptProfileJson } from '../phi-fields'
import { loadPatientProfile, ProfileConflictError, updatePatientProfile } from '../patient-profile-service'

const scope = { orgId: 'org-1', studyId: 'study-1', subjectId: 'subject-1' }
const audit = (next: PatientProfile) => ({ action: 'profile.update' as const, orgId: 'org-1', studyId: 'study-1', userId: 'user_1', resourceType: 'subject', resourceId: 'subject-1', metadata: { source: 'test', labCount: next.labs.length } })
const savedKey = process.env.PHI_ENCRYPTION_KEY
const lab = (name: string, value: number) => ({ name, value, unit: 'mg/dL' })
const stored = (): PatientProfile => parsePatientProfile(decryptProfileJson(store.row!.profileEncrypted))
const writeDirectly = (profile: PatientProfile) => {
  store.row = { profileEncrypted: encryptProfileJson(profile as Record<string, unknown>), updatedAt: new Date(store.row!.updatedAt.getTime() + 5) }
}
const addLab = (name: string, value: number) => (current: PatientProfile): PatientProfile => ({ ...current, labs: [...current.labs, lab(name, value)] })

beforeAll(() => {
  process.env.PHI_ENCRYPTION_KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2)
})
afterAll(() => {
  if (savedKey === undefined) delete process.env.PHI_ENCRYPTION_KEY
  else process.env.PHI_ENCRYPTION_KEY = savedKey
})
beforeEach(() => {
  store.row = { profileEncrypted: encryptProfileJson(parsePatientProfile({}) as Record<string, unknown>), updatedAt: new Date('2026-11-11T10:00:00.000Z') }
  store.interleave = null
  store.writes = 0
  store.enforce = true
  store.audits.length = 0
  store.failAudit = false
  store.looseWrites = 0
})

describe('perfil del sujeto — escritura cuando dos personas trabajan a la vez', () => {
  it('sin nadie más escribiendo, aplica el cambio una vez', async () => {
    const result = await updatePatientProfile(scope, addLab('Glucosa', 92), audit)
    expect(result.labs.map((entry) => entry.name)).toEqual(['Glucosa'])
    expect(stored().labs.map((entry) => entry.name)).toEqual(['Glucosa'])
    expect(store.writes).toBe(1)
    // R3: el perfil y su registro entran por la transacción; el registro lleva conteos, no valores.
    expect(store.looseWrites).toBe(0)
    expect(store.audits).toEqual([{ action: 'profile.update', organizationId: 'org-1', studyId: 'study-1', userId: 'user_1', resourceType: 'subject', resourceId: 'subject-1', metadata: { source: 'test', labCount: 1 } }])
    expect(JSON.stringify(store.audits)).not.toContain('Glucosa')
  })

  it('si otra persona escribió en el medio, no pisa su trabajo: vuelve a leer y aplica el cambio encima', async () => {
    store.interleave = () => writeDirectly({ ...stored(), labs: [lab('Hemoglobina', 13.5)] })
    const result = await updatePatientProfile(scope, addLab('Glucosa', 92), audit)
    expect(stored().labs.map((entry) => entry.name).sort()).toEqual(['Glucosa', 'Hemoglobina'])
    expect(result.labs).toHaveLength(2)
    // El intento que perdió la carrera no escribió: un solo registro, con lo que quedó guardado.
    expect(store.audits).toHaveLength(1)
    expect(store.audits[0]).toMatchObject({ metadata: { labCount: 2 } })
  })

  it('cada escritura deja una marca de tiempo posterior a la anterior, aunque caigan en el mismo milisegundo', async () => {
    const before = store.row!.updatedAt.getTime()
    vi.useFakeTimers({ now: before })
    try {
      await updatePatientProfile(scope, addLab('Glucosa', 92), audit)
    } finally {
      vi.useRealTimers()
    }
    expect(store.row!.updatedAt.getTime()).toBeGreaterThan(before)
  })

  it('si la fila cambia en cada intento, avisa en vez de guardar a ciegas', async () => {
    const collide = () => {
      writeDirectly({ ...stored(), lastUpdatedAt: new Date().toISOString() })
      store.interleave = collide
    }
    store.interleave = collide
    await expect(updatePatientProfile(scope, addLab('Glucosa', 92), audit)).rejects.toBeInstanceOf(ProfileConflictError)
    expect(stored().labs).toEqual([])
    expect(store.audits).toHaveLength(0)
  })

  it('si el registro de auditoría no se puede escribir, el cambio no se da por hecho', async () => {
    store.failAudit = true
    await expect(updatePatientProfile(scope, addLab('Glucosa', 92), audit)).rejects.toThrow('audit insert failed')
    expect(store.audits).toHaveLength(0)
  })

  it('un sujeto sin fila de perfil no se da por guardado', async () => {
    store.row = null
    await expect(updatePatientProfile(scope, addLab('Glucosa', 92), audit)).rejects.toMatchObject({ name: 'ProfileMissingError' })
    expect(await loadPatientProfile(scope)).toMatchObject({ labs: [] })
  })

  it('el cambio puede ser asíncrono y se vuelve a calcular sobre lo último leído', async () => {
    const seen: number[] = []
    store.interleave = () => writeDirectly({ ...stored(), labs: [lab('Urea', 30)] })
    await updatePatientProfile(scope, async (current) => {
      seen.push(current.labs.length)
      return addLab('Creatinina', 0.9)(current)
    }, audit)
    expect(seen).toEqual([0, 1])
  })

  it('la revisión de laboratorio anterior usa la misma escritura: no pisa lo que otro confirmó en el medio', async () => {
    const { confirmLabOcrReview, rejectLabOcrReview } = await import('../lab-review-service')
    writeDirectly({ ...stored(), pendingLabReview: { requiresHumanReview: true, extractedAt: '2026-11-11T10:00:00.000Z', labs: [lab('Glucosa', 92)], redactedSourcePreview: '' } })
    store.interleave = () => writeDirectly({ ...stored(), labs: [lab('Hemoglobina', 13.5)] })
    const confirmAudit = (facts: { labCount: number }) => ({ action: 'lab.confirm' as const, orgId: 'org-1', resourceId: 'subject-1', metadata: facts })
    const profile = await confirmLabOcrReview({ ...scope, audit: confirmAudit })
    // El registro sale con lo que de verdad quedó guardado (dos valores), en la misma transacción.
    expect(store.audits).toEqual([expect.objectContaining({ action: 'lab.confirm', metadata: { labCount: 2 } })])
    expect(profile.labs.map((entry) => entry.name).sort()).toEqual(['Glucosa', 'Hemoglobina'])
    expect(stored().pendingLabReview).toBeUndefined()
    // Ya no hay nada pendiente: rechazar avisa y no escribe.
    const writes = store.writes
    await expect(rejectLabOcrReview({ ...scope, audit: () => ({ action: 'lab.reject' as const, orgId: 'org-1' }) })).rejects.toMatchObject({ code: 'no_pending_review' })
    expect(store.writes).toBe(writes)
    expect(store.audits).toHaveLength(1)
  })
})

describe('perfil del sujeto — lo que se extrae de una evolución espera a una persona (R6)', () => {
  const EVO = '11111111-1111-4111-8111-111111111111'
  const OTHER = '22222222-2222-4222-8222-222222222222'
  const proposal = (evolutionId: string, name: string, value: number) => ({
    requiresHumanReview: true as const,
    evolutionId,
    extractedAt: '2026-11-12T12:00:00.000Z',
    facts: { labs: [lab(name, value)], medications: [{ name: 'Metformina' }], conditions: [] },
    fieldConfidence: { labs: { [name.toLowerCase()]: 'medium' as const } },
  })
  const pendingLabReview = { requiresHumanReview: true as const, extractedAt: '2026-11-11T10:00:00.000Z', labs: [lab('Urea', 30)], redactedSourcePreview: '' }
  const who = { ...scope, userId: 'user_md' }

  it('mientras nadie la acepta, la propuesta no forma parte de los datos del perfil', async () => {
    writeDirectly({ ...stored(), pendingEvolutionProposals: [proposal(EVO, 'HbA1c', 8.2)] })
    const profile = await loadPatientProfile(scope)
    expect(profile.labs).toEqual([])
    expect(profile.medications).toEqual([])
    expect(profile.pendingEvolutionProposals).toHaveLength(1)
  })

  it('aceptar pasa los datos al perfil, saca esa propuesta y conserva lo demás que espera revisión', async () => {
    const { confirmProfileProposal } = await import('../patient-profile-service')
    writeDirectly({ ...stored(), pendingLabReview, pendingEvolutionProposals: [proposal(EVO, 'HbA1c', 8.2), proposal(OTHER, 'Glucosa', 110)] })

    const profile = await confirmProfileProposal({ ...who, evolutionId: EVO })

    expect(profile.labs.map((entry) => entry.name)).toEqual(['HbA1c'])
    expect(profile.medications.map((entry) => entry.name)).toEqual(['Metformina'])
    expect(stored().pendingEvolutionProposals?.map((entry) => entry.evolutionId)).toEqual([OTHER])
    // La revisión de laboratorio pendiente no se pierde al aceptar otra cosa.
    expect(stored().pendingLabReview?.labs.map((entry) => entry.name)).toEqual(['Urea'])
    // El registro dice quién lo aceptó y que hubo confirmación humana; sin valores.
    expect(store.audits).toEqual([
      { action: 'profile.update', organizationId: 'org-1', studyId: 'study-1', userId: 'user_md', resourceType: 'subject', resourceId: 'subject-1', metadata: { source: 'evolution_extraction', evolutionId: EVO, automated: false, humanConfirmed: true, factCount: 2 } },
    ])
    expect(JSON.stringify(store.audits)).not.toContain('HbA1c')
    expect(store.looseWrites).toBe(0)
  })

  it('descartar deja el perfil como estaba y lo registra', async () => {
    const { rejectProfileProposal } = await import('../patient-profile-service')
    writeDirectly({ ...stored(), labs: [lab('Creatinina', 0.9)], pendingEvolutionProposals: [proposal(EVO, 'HbA1c', 8.2)] })

    const profile = await rejectProfileProposal({ ...who, evolutionId: EVO })

    expect(profile.labs.map((entry) => entry.name)).toEqual(['Creatinina'])
    expect(stored().pendingEvolutionProposals).toBeUndefined()
    expect(store.audits).toEqual([expect.objectContaining({ action: 'profile.proposal.reject', userId: 'user_md', metadata: { source: 'evolution_extraction', evolutionId: EVO, humanConfirmed: false } })])
  })

  it('sin propuesta para esa evolución: avisa, no escribe y no registra', async () => {
    const { confirmProfileProposal, rejectProfileProposal } = await import('../patient-profile-service')
    writeDirectly({ ...stored(), pendingEvolutionProposals: [proposal(OTHER, 'Glucosa', 110)] })
    const writes = store.writes

    await expect(confirmProfileProposal({ ...who, evolutionId: EVO })).rejects.toMatchObject({ code: 'no_pending_proposal' })
    await expect(rejectProfileProposal({ ...who, evolutionId: EVO })).rejects.toMatchObject({ code: 'no_pending_proposal' })
    expect(store.writes).toBe(writes)
    expect(store.audits).toHaveLength(0)
  })

  it('aceptar dos veces la misma propuesta no duplica nada', async () => {
    const { confirmProfileProposal } = await import('../patient-profile-service')
    writeDirectly({ ...stored(), pendingEvolutionProposals: [proposal(EVO, 'HbA1c', 8.2)] })
    await confirmProfileProposal({ ...who, evolutionId: EVO })
    await expect(confirmProfileProposal({ ...who, evolutionId: EVO })).rejects.toMatchObject({ code: 'no_pending_proposal' })
    expect(stored().labs).toHaveLength(1)
    expect(store.audits).toHaveLength(1)
  })
})
