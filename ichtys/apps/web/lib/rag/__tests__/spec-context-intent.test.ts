import { describe, expect, it } from 'vitest'
import { detectSpecIntent } from '../spec-context'

/**
 * Corrida 2 del E2E (2026-10-22): las preguntas #3 (IMC) y #4 (eGFR/UACR)
 * no matcheaban ninguna keyword de eligibility — hablaban de conceptos clínicos
 * de elegibilidad sin usar la palabra "criterio" — así que el spec extraído
 * nunca se inyectaba y el retrieval vectorial solo no alcanzaba el threshold
 * → insufficient_evidence aunque los datos estaban en el spec.
 */
describe('detectSpecIntent — conceptos clínicos de elegibilidad', () => {
  it('#3 E2E: pregunta de IMC sin la palabra "criterio" matchea eligibility', () => {
    const r = detectSpecIntent('¿Qué índice de masa corporal mínimo se requiere para ingresar?')
    expect(r).toContain('eligibility')
  })

  it('#3 E2E: sigla IMC también matchea eligibility', () => {
    expect(detectSpecIntent('¿Cuál es el IMC máximo permitido?')).toContain('eligibility')
  })

  it('#4 E2E: eGFR/UACR/nefropatía para ingresar matchea eligibility', () => {
    const r = detectSpecIntent(
      '¿Qué valores de eGFR o UACR definen la nefropatía crónica para ingresar al estudio?',
    )
    expect(r).toContain('eligibility')
  })

  it('HbA1c matchea eligibility', () => {
    expect(detectSpecIntent('¿Qué límite de HbA1c se exige?')).toContain('eligibility')
  })

  it('pregunta de ayuno/visita NO matchea eligibility', () => {
    const r = detectSpecIntent('¿Cuántas horas de ayuno se requieren antes de la visita 2?')
    expect(r).not.toContain('eligibility')
  })

  it('pregunta de dosis NO matchea eligibility', () => {
    const r = detectSpecIntent('¿Cómo se titula la dosis de semaglutida?')
    expect(r).not.toContain('eligibility')
  })
})
