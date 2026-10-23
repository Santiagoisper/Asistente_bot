import { describe, expect, it } from 'vitest'
import { appendClinicalSynonyms, expandShortQueryForRetrieval } from '../query-expander'

/**
 * Corrida 2 del E2E (2026-10-22): el retrieval vectorial matchea mejor cuando
 * la query lleva el equivalente inglés de las siglas clínicas en español
 * (IMC↔BMI, eGFR↔glomerular filtration rate, ...). Solo afecta a la búsqueda
 * de chunks — la pregunta original llega intacta al answer engine.
 */
describe('appendClinicalSynonyms — sinónimos clínicos ES↔EN para retrieval', () => {
  it('#3 E2E: IMC agrega el equivalente inglés BMI', () => {
    const q = appendClinicalSynonyms('¿Qué índice de masa corporal mínimo se requiere para ingresar?')
    expect(q).toContain('BMI')
    expect(q).toContain('índice de masa corporal')
  })

  it('#4 E2E: eGFR y UACR agregan sus equivalentes', () => {
    const q = appendClinicalSynonyms('¿Qué valores de eGFR o UACR definen la nefropatía crónica?')
    expect(q).toContain('glomerular filtration rate')
    expect(q).toContain('albumin-to-creatinine')
    expect(q).toContain('nephropathy')
  })

  it('dirección inversa: BMI agrega IMC', () => {
    expect(appendClinicalSynonyms('What is the BMI cutoff?')).toContain('IMC')
  })

  it('no agrega nada si la pregunta no tiene términos clínicos', () => {
    const q = '¿Cuándo es la aleatorización del estudio?'
    expect(appendClinicalSynonyms(q)).toBe(q)
  })

  it('no duplica: si BMI ya está, no vuelve a agregarlo', () => {
    const q = appendClinicalSynonyms('¿Qué dice del IMC y del BMI el protocolo?')
    expect(q.match(/bmi/gi)?.length).toBe(1)
  })
})

describe('expandShortQueryForRetrieval — integración con sinónimos', () => {
  it('pregunta larga con IMC mantiene el texto original + sinónimo', () => {
    const q = expandShortQueryForRetrieval({
      question: '¿Qué índice de masa corporal mínimo se requiere para ingresar?',
      studyName: 'GZBO',
      protocolNumber: 'GZBO-301',
    })
    expect(q).toContain('índice de masa corporal')
    expect(q).toContain('BMI')
  })

  it('regresión: query corta de visitas sigue expandiendo a la plantilla', () => {
    const q = expandShortQueryForRetrieval({ question: 'visita 2', studyName: 'GZBO', protocolNumber: null })
    expect(q).toContain('visitas, ventanas y procedimientos')
  })

  it('query corta con IMC conserva el sinónimo BMI', () => {
    const q = expandShortQueryForRetrieval({ question: 'IMC', studyName: 'GZBO', protocolNumber: null })
    expect(q).toContain('IMC')
    expect(q).toContain('BMI')
  })
})
