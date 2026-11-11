import { describe, expect, it } from 'vitest'
import { parsePatientProfile } from '@ichtys/clinical'
import { labReviewMarker } from '../lab-review-marker'

const pending = (extractedAt: string) =>
  parsePatientProfile({
    pendingLabReview: {
      requiresHumanReview: true,
      extractedAt,
      labs: [{ name: 'HbA1c', value: 7.1, unit: '%' }],
    },
  })

describe('labReviewMarker — marca no sensible de revisión de laboratorio pendiente', () => {
  it('perfil con revisión pendiente: marca encendida y fecha de la extracción', () => {
    const marker = labReviewMarker(pending('2026-11-10T14:30:00.000Z'))
    expect(marker.labReviewPending).toBe(true)
    expect(marker.labReviewPendingSince?.toISOString()).toBe('2026-11-10T14:30:00.000Z')
  })

  it('perfil sin revisión pendiente: marca apagada y fecha nula', () => {
    expect(labReviewMarker(parsePatientProfile({}))).toEqual({
      labReviewPending: false,
      labReviewPendingSince: null,
    })
  })

  it('fecha de extracción ilegible: la marca queda encendida y la fecha nula', () => {
    expect(labReviewMarker(pending('no-es-una-fecha'))).toEqual({
      labReviewPending: true,
      labReviewPendingSince: null,
    })
  })

  it('no copia ningún valor clínico: solo devuelve la marca y la fecha', () => {
    expect(Object.keys(labReviewMarker(pending('2026-11-10T14:30:00.000Z'))).sort()).toEqual([
      'labReviewPending',
      'labReviewPendingSince',
    ])
  })
})
