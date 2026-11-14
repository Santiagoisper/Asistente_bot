import { describe, expect, it } from 'vitest'
import { matchProtocolVisit, type ProtocolVisit } from '../dictation/visit-procedures'

const visits: ProtocolVisit[] = [
  { name: 'Visita 1 (Selección)', label: 'Semana -4', procedures: ['Consentimiento informado', 'Signos vitales'], sourcePages: [41] },
  { name: 'Visita 2 (Aleatorización)', label: 'Semana 0', procedures: ['Signos vitales', 'Dispensación de medicación'], sourcePages: [41] },
  { name: 'Visita 3', label: 'Semana 4', procedures: ['Signos vitales'], sourcePages: [42] },
  { name: 'Visita 12', label: 'Semana 40', procedures: ['Electrocardiograma'], sourcePages: [42] },
  { name: 'Visita de seguimiento', label: 'Semana 44', procedures: ['Registro de eventos adversos'], sourcePages: [42] },
]
const name = (typed: string, list: readonly ProtocolVisit[] = visits) => matchProtocolVisit(typed, list)?.name ?? null

describe('qué visita del protocolo es la que escribió la persona', () => {
  it('reconoce el nombre aunque venga sin tildes, en minúsculas o con espacios de más', () => {
    expect(name('Visita 3')).toBe('Visita 3')
    expect(name('  visita   3 ')).toBe('Visita 3')
    expect(name('Visita 2 (Aleatorizacion)')).toBe('Visita 2 (Aleatorización)')
  })

  it('reconoce una parte del nombre si señala una sola visita', () => {
    expect(name('Visita 1')).toBe('Visita 1 (Selección)')
    expect(name('selección')).toBe('Visita 1 (Selección)')
    expect(name('Seguimiento')).toBe('Visita de seguimiento')
  })

  it('«V2» y «Visita 2» son la misma visita', () => {
    expect(name('V2')).toBe('Visita 2 (Aleatorización)')
    expect(name('v 3')).toBe('Visita 3')
    expect(name('Visita 3', [{ name: 'V3', label: null, procedures: [] }])).toBe('V3')
  })

  it('reconoce la etiqueta de tiempo', () => {
    expect(name('Semana 0')).toBe('Visita 2 (Aleatorización)')
    expect(name('semana 40')).toBe('Visita 12')
  })

  it('un número no vale por otro que lo contiene, ni un negativo por un positivo', () => {
    expect(name('Visita 1')).not.toBe('Visita 12')
    expect(name('Semana 4')).toBe('Visita 3')
    expect(name('Semana -4')).toBe('Visita 1 (Selección)')
  })

  it('si lo escrito señala más de una visita, o ninguna, no elige', () => {
    expect(name('Visita')).toBeNull()
    expect(name('Semana')).toBeNull()
    expect(name('Basal')).toBeNull()
    expect(name('')).toBeNull()
    expect(name('   ')).toBeNull()
    expect(name('Visita 3', [])).toBeNull()
  })

  it('dos visitas con el mismo nombre en el protocolo: no elige', () => {
    const repeated: ProtocolVisit[] = [
      { name: 'Visita 3', label: 'Semana 4', procedures: ['A'] },
      { name: 'Visita 3', label: 'Semana 8', procedures: ['B'] },
    ]
    expect(name('Visita 3', repeated)).toBeNull()
    expect(name('Semana 8', repeated)).toBe('Visita 3')
  })
})
