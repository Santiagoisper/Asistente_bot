import { describe, expect, it } from 'vitest'
import { extractFactsFromEvolution } from '../extract-facts'
import { mergeExtractions } from '../extract-merge'

describe('mergeExtractions', () => {
  it('marca alta confianza cuando heurística y LLM coinciden en HbA1c', () => {
    const text = 'Paciente de 52 años. HbA1c 8.2%. Metformina 850 mg.'
    const heuristic = extractFactsFromEvolution(text)
    const llm = {
      ageYears: 52,
      labs: [{ name: 'HbA1c', value: 8.2, unit: '%' }],
      medications: [{ name: 'Metformina', dose: '850 mg' }],
      conditions: [] as string[],
    }
    const { facts, fieldConfidence } = mergeExtractions(heuristic, llm)
    expect(facts.labs.find((l) => l.name === 'HbA1c')?.value).toBe(8.2)
    expect(fieldConfidence.ageYears).toBe('high')
    expect(fieldConfidence.labs?.hba1c).toBe('high')
  })

  it('marca baja confianza cuando solo hay heurística', () => {
    const text = 'Paciente de 45 años. HbA1c 7.1%.'
    const heuristic = extractFactsFromEvolution(text)
    const { fieldConfidence } = mergeExtractions(heuristic, null)
    expect(fieldConfidence.ageYears).toBe('low')
    expect(fieldConfidence.labs?.hba1c).toBe('low')
  })

  it('marca media confianza cuando solo LLM aporta edad', () => {
    const heuristic = extractFactsFromEvolution('HbA1c 8.0%')
    const llm = {
      ageYears: 60,
      labs: [{ name: 'HbA1c', value: 8, unit: '%' }],
      medications: [],
      conditions: [],
    }
    const { fieldConfidence } = mergeExtractions(heuristic, llm)
    expect(fieldConfidence.ageYears).toBe('medium')
    expect(fieldConfidence.labs?.hba1c).toBe('high')
  })
})
