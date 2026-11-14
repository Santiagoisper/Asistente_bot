import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * C4 paso 2 (D1, prueba 8): los valores de un texto pegado que una persona confirma quedan
 * en el perfil con su origen. Se ejercita `confirmLabOcrReview` entero, con el perfil en
 * memoria en lugar de la base.
 */
const state = vi.hoisted(() => ({ profile: null as unknown }))

vi.mock('../patient-profile-service', () => ({
  updatePatientProfile: async (_scope: unknown, mutate: (current: unknown) => unknown, audit: (next: unknown) => unknown) => {
    const next = await mutate(state.profile)
    audit(next)
    return next
  },
}))

import { confirmLabOcrReview } from '../lab-review-service'

const EVOLUTION = '22222222-2222-4222-8222-222222222222'
const REPORT = '11111111-1111-4111-8111-111111111111'
const scope = { orgId: 'org-1', studyId: 'study-1', subjectId: 'subject-1', audit: () => ({ action: 'profile.update' }) as never }
const pending = (labs: unknown[]) => ({
  version: 1,
  labs: [{ name: 'Creatinina', value: 0.9, sourceEvolutionId: EVOLUTION, source: { kind: 'evolution', evolutionId: EVOLUTION } }],
  medications: [],
  conditions: [],
  pendingLabReview: { requiresHumanReview: true, labs, extractedAt: '2026-11-14T10:00:00.000Z' },
})

beforeEach(() => {
  state.profile = pending([{ name: 'Glucemia', value: 132, unit: 'mg/dL' }])
})

describe('confirmLabOcrReview — origen de lo confirmado', () => {
  it('lo pendiente, confirmado tal cual, entra con source = { kind: pasted_text }', async () => {
    const profile = await confirmLabOcrReview(scope)
    expect(profile.labs.find((lab) => lab.name === 'Glucemia')).toEqual({ name: 'Glucemia', value: 132, unit: 'mg/dL', source: { kind: 'pasted_text' } })
  })

  it('los valores corregidos por la persona también, aunque lleguen diciendo otro origen', async () => {
    const profile = await confirmLabOcrReview({
      ...scope,
      labsOverride: [{ name: 'Glucemia', value: 128, source: { kind: 'lab_report', reportId: REPORT }, sourceEvolutionId: EVOLUTION } as never],
    })
    expect(profile.labs.find((lab) => lab.name === 'Glucemia')).toEqual({ name: 'Glucemia', value: 128, source: { kind: 'pasted_text' } })
  })

  it('un valor que ya estaba en el perfil conserva su origen', async () => {
    const profile = await confirmLabOcrReview(scope)
    expect(profile.labs.find((lab) => lab.name === 'Creatinina')).toEqual({ name: 'Creatinina', value: 0.9, sourceEvolutionId: EVOLUTION, source: { kind: 'evolution', evolutionId: EVOLUTION } })
  })
})
