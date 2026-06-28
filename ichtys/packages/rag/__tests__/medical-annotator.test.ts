/**
 * medical-annotator.test.ts
 *
 * Tests for the exact-match annotator.
 * Key invariants:
 *  1. Correct matches — clinical terms / abbreviations produce correct codes.
 *  2. No false positives — common Spanish words starting with same letters are rejected.
 *  3. Longest-match wins — more specific entry beats generic when both could match.
 *  4. Uppercase guard — abbreviations ≤ 3 chars require uppercase first char in original text.
 *  5. Position mapping — startIndex/endIndex correctly refer to original (un-normalized) text.
 *  6. Deduplication — overlapping spans are not double-annotated.
 */

import { describe, it, expect } from 'vitest'
import { annotateAnswerSync } from '../medical-annotator'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function codes(text: string) {
  return annotateAnswerSync(text).map((a) => a.code)
}

function terms(text: string) {
  return annotateAnswerSync(text).map((a) => a.term)
}
void terms // used in future tests

function normalized(text: string) {
  return annotateAnswerSync(text).map((a) => a.normalizedTerm)
}
void normalized // used in future tests

// ---------------------------------------------------------------------------
// 1. Correct matches — conditions
// ---------------------------------------------------------------------------

describe('conditions', () => {
  it('matches insuficiencia renal cronica with diacritics', () => {
    const anns = annotateAnswerSync('El paciente tiene insuficiencia renal crónica estadio 3.')
    expect(anns).toHaveLength(1)
    expect(anns[0]?.code).toBe('709044004')
    expect(anns[0]?.system).toBe('SNOMED-CT')
    expect(anns[0]?.term).toBe('insuficiencia renal crónica')  // original casing preserved
  })

  it('matches embolia pulmonar', () => {
    const anns = annotateAnswerSync('Antecedente de embolia pulmonar en el último año.')
    expect(anns.some((a) => a.code === '59282003')).toBe(true)
  })

  it('matches diabetes mellitus tipo 2 (longest match wins)', () => {
    const anns = annotateAnswerSync('El paciente tiene diabetes mellitus tipo 2.')
    // Should match "diabetes mellitus tipo 2" (44054006), NOT "diabetes mellitus" (73211009)
    const dm2 = anns.find((a) => a.code === '44054006')
    const dmGeneric = anns.find((a) => a.code === '73211009')
    expect(dm2).toBeDefined()
    expect(dmGeneric).toBeUndefined()
  })

  it('matches diabetes mellitus generic when no tipo specified', () => {
    const anns = annotateAnswerSync('Historial de diabetes mellitus previo.')
    expect(anns.some((a) => a.code === '73211009')).toBe(true)
  })

  it('matches hypertension in English', () => {
    expect(codes('Exclusion criterion: hypertension.')).toContain('38341003')
  })

  it('matches hipertension in Spanish', () => {
    expect(codes('Criterio de exclusion: hipertension arterial.')).toContain('38341003')
  })

  it('matches neutropenia', () => {
    expect(codes('Neutropenia grave (ANC < 500/μL) es criterio de exclusión.')).toContain('165517008')
  })

  it('matches multiple conditions in one sentence', () => {
    const text = 'Se excluyen pacientes con embolia pulmonar, anemia o hipertensión.'
    const c = codes(text)
    expect(c).toContain('59282003') // PE
    expect(c).toContain('271737000') // anaemia
    expect(c).toContain('38341003') // hypertension
  })
})

// ---------------------------------------------------------------------------
// 2. Lab values (LOINC)
// ---------------------------------------------------------------------------

describe('lab values', () => {
  it('matches creatinina', () => {
    const anns = annotateAnswerSync('El valor de creatinina fue 2.1 mg/dL.')
    expect(anns.some((a) => a.code === '2160-0' && a.system === 'LOINC')).toBe(true)
  })

  it('matches HbA1c (mixed case)', () => {
    const anns = annotateAnswerSync('HbA1c > 8% fue criterio de exclusión.')
    expect(anns.some((a) => a.code === '4548-4')).toBe(true)
    // Original casing preserved
    expect(anns.find((a) => a.code === '4548-4')?.term).toBe('HbA1c')
  })

  it('matches plaquetas', () => {
    expect(codes('Plaquetas < 50.000/μL define trombocitopenia.')).toContain('777-3')
  })

  it('matches ALT and AST together', () => {
    const c = codes('ALT > 3× ULN o AST > 5× ULN son criterios de safety.')
    expect(c).toContain('1742-6') // ALT
    expect(c).toContain('1920-8') // AST
  })
})

// ---------------------------------------------------------------------------
// 3. Uppercase guard — abbreviations ≤ 3 chars
// ---------------------------------------------------------------------------

describe('uppercase guard for short abbreviations', () => {
  it('matches uppercase CK', () => {
    expect(codes('CK > 5× ULN fue elevada.')).toContain('2157-6')
  })

  it('does NOT match lowercase ck inside other words', () => {
    expect(codes('check the results of the analysis.')).not.toContain('2157-6')
  })

  it('matches uppercase FA (fosfatasa alcalina)', () => {
    expect(codes('FA elevada más de 3 veces.')).toContain('6768-6')
  })

  it('does NOT match fa in falla, factor, farmaco, fase, familiar', () => {
    const fp_sentences = [
      'La historia familiar de cáncer fue evaluada.',
      'El uso de fármacos anticoagulantes está prohibido.',
      'Se observó falla hepática en 2 pacientes.',
      'La fase de screening duró 2 semanas.',
      'El factor de riesgo fue evaluado.',
    ]
    for (const text of fp_sentences) {
      const anns = annotateAnswerSync(text)
      const faMatch = anns.find((a) => a.normalizedTerm === 'fa')
      expect(faMatch).toBeUndefined()
    }
  })

  it('matches uppercase Hb', () => {
    expect(codes('Hb < 10 g/dL define anemia.')).toContain('718-7')
  })

  it('does NOT match hb in inhibit, inhabit, etc.', () => {
    const anns = annotateAnswerSync('La inhibicion del receptor fue evaluada.')
    expect(anns.find((a) => a.normalizedTerm === 'hb')).toBeUndefined()
  })

  it('matches uppercase TP', () => {
    expect(codes('El TP basal fue 14 segundos.')).toContain('5902-2')
  })

  it('matches uppercase INR', () => {
    expect(codes('INR > 1.5 fue criterio de exclusión.')).toContain('5895-7')
  })

  it('matches uppercase TVP and TEP', () => {
    const c = codes('Antecedente de TVP o TEP son criterios de exclusión.')
    expect(c).toContain('128053003') // DVT
    expect(c).toContain('59282003')  // PE
  })

  it('does NOT match alt inside alternative or alternativos', () => {
    expect(codes('alternative treatment options available.')).not.toContain('1742-6')
    expect(codes('Se evaluaron tratamientos alternativos.')).not.toContain('1742-6')
  })
})

// ---------------------------------------------------------------------------
// 4. Position mapping — original text positions
// ---------------------------------------------------------------------------

describe('position mapping', () => {
  it('startIndex/endIndex reference original (un-normalized) text', () => {
    const text = 'El paciente tiene insuficiencia renal crónica (estadio 3).'
    const anns = annotateAnswerSync(text)
    const ckd = anns.find((a) => a.code === '709044004')
    expect(ckd).toBeDefined()
    expect(text.slice(ckd!.startIndex, ckd!.endIndex)).toBe('insuficiencia renal crónica')
  })

  it('extracts correct span for HbA1c (mixed ASCII case)', () => {
    const text = 'Baseline HbA1c > 8% fue criterio de exclusión en diabéticos.'
    const anns = annotateAnswerSync(text)
    const a = anns.find((a) => a.code === '4548-4')
    expect(a).toBeDefined()
    expect(text.slice(a!.startIndex, a!.endIndex)).toBe('HbA1c')
  })

  it('startIndex + term.length === endIndex', () => {
    const text = 'Embolia pulmonar y neutropenia fueron criterios de exclusión.'
    const anns = annotateAnswerSync(text)
    for (const a of anns) {
      expect(a.startIndex + a.term.length).toBe(a.endIndex)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. No overlap — longest match wins
// ---------------------------------------------------------------------------

describe('no overlapping annotations', () => {
  it('does not produce overlapping spans', () => {
    const text = 'Insuficiencia renal crónica, insuficiencia hepática y embolia pulmonar.'
    const anns = annotateAnswerSync(text)
    for (let i = 0; i < anns.length; i++) {
      for (let j = i + 1; j < anns.length; j++) {
        const a = anns[i]!
        const b = anns[j]!
        const overlaps = a.startIndex < b.endIndex && a.endIndex > b.startIndex
        expect(overlaps).toBe(false)
      }
    }
  })

  it('"insuficiencia renal cronica" wins over "insuficiencia renal"', () => {
    const text = 'El paciente tiene insuficiencia renal crónica estadio 3.'
    const anns = annotateAnswerSync(text)
    const renalGeneric = anns.find((a) => a.code === '42399005')
    const renalCronica = anns.find((a) => a.code === '709044004')
    expect(renalCronica).toBeDefined()
    expect(renalGeneric).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 6. fromDictionary flag
// ---------------------------------------------------------------------------

describe('fromDictionary flag', () => {
  it('all sync annotations have fromDictionary = true', () => {
    const anns = annotateAnswerSync('Insuficiencia renal crónica y embolia pulmonar.')
    expect(anns.every((a) => a.fromDictionary === true)).toBe(true)
  })
})
