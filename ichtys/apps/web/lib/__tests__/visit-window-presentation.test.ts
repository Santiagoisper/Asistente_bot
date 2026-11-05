import { describe, expect, it } from 'vitest'
import type { StudySpec } from '@ichtys/ingestion'
import { formatVisits } from '../rag/spec-context'
import { buildHtml } from '../../app/api/studies/[id]/spec/[specId]/export/route'

const legacyVisit = {
  name: 'Visita 4',
  label: 'Semana 12',
  day: 85,
  windowDays: 3,
  windowBefore: null,
  windowAfter: null,
  procedures: ['HbA1c'],
  sourcePages: [19],
  confidence: 'high' as const,
}

const asymmetricVisit = {
  ...legacyVisit,
  name: 'Día 21',
  label: 'Día 21',
  day: 21,
  windowDays: 3,
  windowBefore: 2,
  windowAfter: 3,
}

function spec(visits: StudySpec['visits']): StudySpec {
  return {
    identification: { protocolCode: 'FICT-01', title: 'Estudio ficticio', phase: '3', sourcePages: [1] },
    inclusionCriteria: [],
    exclusionCriteria: [],
    endpoints: [],
    visits,
  } as StudySpec
}

describe('T7 y T8 en export, pantalla y chat', () => {
  it('el export HTML imprime −2/+3 d y, para una spec legada, ±3 d', () => {
    const html = buildHtml(spec([asymmetricVisit, legacyVisit]), 1, 'draft')
    expect(html).toContain('Ventana (días)')
    expect(html).toContain('\u22122/+3 d')
    expect(html).toContain('±3 d')
  })

  it('el chat usa el mismo texto', () => {
    const text = formatVisits(spec([asymmetricVisit, legacyVisit]))
    expect(text).toContain('\u22122/+3 d')
    expect(text).toContain('±3 d')
    expect(text).not.toContain('±3d')
  })
})
