import { describe, expect, it } from 'vitest'
import { studyVisitSchema } from '@ichtys/ingestion/study-spec'
import { guideVisits } from '../guide-visits'

const visits = [
  { name: 'Visita 1 (Selección)', label: 'Semana -4', day: -28, windowDays: 3, procedures: ['Consentimiento informado', 'Signos vitales'], sourcePages: [41], confidence: 'high' },
  { name: 'Visita 3', label: null, day: 28, windowDays: null, windowBefore: 2, windowAfter: 5, procedures: [], sourcePages: [42, 43], confidence: 'low' },
].map((visit) => studyVisitSchema.parse(visit))

describe('las visitas del protocolo que viajan a la guía de dictado', () => {
  it('lleva el nombre, la etiqueta, los procedimientos y las páginas; nada más', () => {
    const sent = guideVisits({ visits })
    expect(sent).toEqual([
      { name: 'Visita 1 (Selección)', label: 'Semana -4', procedures: ['Consentimiento informado', 'Signos vitales'], sourcePages: [41] },
      { name: 'Visita 3', label: null, procedures: [], sourcePages: [42, 43] },
    ])
  })

  it('un protocolo sin cronograma da una lista vacía', () => {
    expect(guideVisits({ visits: [] })).toEqual([])
  })
})
