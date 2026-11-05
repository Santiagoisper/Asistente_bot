/**
 * ADR-3 §2.4 — al reemplazar las visitas del protocolo por las de una guía
 * SoA, el resultado del grupo `visits` también se reemplaza: el del spec
 * previo describía visitas que ya no están y no puede gobernar la aprobación
 * del spec nuevo. Los demás grupos no se tocan.
 */
import { describe, expect, it } from 'vitest'
import { emptyStudySpec, mergeSoaVisits, type StudySpec } from '../study-spec'

const VISIT: StudySpec['visits'][number] = {
  name: 'Visita SoA 1',
  label: 'Semana 4',
  day: 28,
  windowDays: 2,
  windowBefore: null,
  windowAfter: null,
  procedures: ['PK'],
  sourcePages: [3],
  confidence: 'high',
}

describe('mergeSoaVisits — el resultado de visits sigue a las visitas que reemplaza', () => {
  it('sin spec previo, el resultado de visits de la extracción SoA se conserva', () => {
    const merged = mergeSoaVisits(null, [VISIT], 'soa-1', {
      status: 'invalid_output',
      code: 'item_repaired',
    })

    expect(merged.visits).toEqual([VISIT])
    expect(merged.groupOutcomes).toEqual({
      visits: { status: 'invalid_output', code: 'item_repaired' },
    })
    expect(merged.visitsSource).toEqual({ documentVersionId: 'soa-1', documentType: 'soa' })
  })

  it('un visits invalid_output previo no sobrevive a un SoA limpio', () => {
    const previous: StudySpec = {
      ...emptyStudySpec(),
      visits: [{ ...VISIT, name: 'Visita protocolo' }],
      groupOutcomes: { visits: { status: 'invalid_output', code: 'item_discarded' } },
    }

    const merged = mergeSoaVisits(previous, [VISIT], 'soa-1')

    expect(merged.groupOutcomes).toBeUndefined()
  })

  it('un visits previo se reemplaza por el del SoA, no se suman', () => {
    const previous: StudySpec = {
      ...emptyStudySpec(),
      groupOutcomes: {
        visits: { status: 'invalid_output', code: 'item_discarded' },
        eligibility: { status: 'invalid_output', code: 'item_repaired' },
      },
    }

    const merged = mergeSoaVisits(previous, [VISIT], 'soa-1', {
      status: 'invalid_output',
      code: 'item_repaired',
    })

    expect(merged.groupOutcomes?.visits).toEqual({
      status: 'invalid_output',
      code: 'item_repaired',
    })
    expect(merged.groupOutcomes?.eligibility).toEqual({
      status: 'invalid_output',
      code: 'item_repaired',
    })
  })

  it('los grupos ajenos a visits se conservan aunque el SoA no traiga resultado', () => {
    const previous: StudySpec = {
      ...emptyStudySpec(),
      groupOutcomes: {
        eligibility: { status: 'provider_error', code: 'llm_timeout' },
        endpoints: { status: 'ok' },
      },
    }

    const merged = mergeSoaVisits(previous, [VISIT], 'soa-1')

    expect(merged.groupOutcomes).toEqual({
      eligibility: { status: 'provider_error', code: 'llm_timeout' },
      endpoints: { status: 'ok' },
    })
  })
})
