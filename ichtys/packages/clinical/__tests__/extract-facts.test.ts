import { describe, expect, it } from 'vitest'
import { extractFactsFromEvolution, mergeProfileWithFacts } from '../extract-facts'
import { emptyPatientProfile } from '../profile-schema'

describe('extractFactsFromEvolution', () => {
  it('extrae edad, PA, glucosa alta y metformina', () => {
    const facts = extractFactsFromEvolution(
      'paciente que tiene 52 años, tiene glucosa alta, y presion arterial 80/120. Metformina 850 mg c/12h',
    )
    expect(facts.ageYears).toBe(52)
    expect(facts.systolic).toBe(80)
    expect(facts.diastolic).toBe(120)
    expect(facts.conditions).toContain('Glucosa elevada (texto libre)')
    expect(facts.medications[0]?.name).toBe('Metformina')
  })

  it('extrae HbA1c y DM2', () => {
    const facts = extractFactsFromEvolution(
      'Paciente en screening. Metformina 850 mg c/12h. HbA1c 8.2%. Antecedente DM2.',
    )
    expect(facts.labs.find((l) => l.name === 'HbA1c')?.value).toBe(8.2)
    expect(facts.conditions).toContain('DM2')
  })
})

describe('mergeProfileWithFacts', () => {
  it('actualiza labs y conserva datos previos', () => {
    const base = emptyPatientProfile()
    const facts = extractFactsFromEvolution('HbA1c 7.5%', '00000000-0000-4000-8000-000000000001')
    const merged = mergeProfileWithFacts(base, facts, '00000000-0000-4000-8000-000000000001')
    expect(merged.labs[0]?.value).toBe(7.5)
    expect(merged.lastEvolutionId).toBe('00000000-0000-4000-8000-000000000001')
  })
})
