import { describe, expect, it } from 'vitest'
import { assessScreening } from '../screening-engine'
import { parseLabOcrText } from '../lab-ocr-parser'
import { gfrFormulas, mentionsCreatinineClearance } from '../numeric-criteria'
import type { PatientProfile } from '../profile-schema'

/**
 * El filtrado glomerular estimado y el aclaramiento de creatinina son dos medidas distintas.
 * El motor solo sabe comparar la primera. Si el criterio o el laboratorio nombran la otra, o
 * nombran fórmulas que no coinciden, el resultado es «a revisar», nunca verde ni rojo.
 * Todos los valores son inventados.
 */
const profile = (labs: PatientProfile['labs']): PatientProfile => ({ version: 1, labs, medications: [], conditions: [] })
const inclusion = (text: string) => ({ inclusionCriteria: [{ number: '1', text, sourcePages: [10] }], exclusionCriteria: [] })
const exclusion = (text: string) => ({ inclusionCriteria: [], exclusionCriteria: [{ number: '1', text, sourcePages: [10] }] })
const EGFR = { name: 'eGFR', value: 72, unit: 'mL/min/1.73m2' }

describe('reconocer el aclaramiento de creatinina', () => {
  it.each([
    'Aclaramiento de creatinina ≥ 60 mL/min',
    'Clearance de creatinina',
    'depuración de creatinina',
    'creatinine clearance (Cockcroft-Gault)',
    'TFG estimada por Cockcroft-Gault',
    'CrCl < 30 mL/min',
    'ClCr ≥ 50',
  ])('«%s» nombra el aclaramiento', (text) => {
    expect(mentionsCreatinineClearance(text)).toBe(true)
  })

  it.each(['eGFR ≥ 60 mL/min/1,73 m²', 'Creatinina sérica ≤ 1,5 mg/dL', 'Filtrado glomerular estimado (CKD-EPI)'])(
    '«%s» no lo nombra',
    (text) => {
      expect(mentionsCreatinineClearance(text)).toBe(false)
    },
  )

  it('reconoce las fórmulas del filtrado estimado que nombra un texto', () => {
    expect(gfrFormulas('eGFR (CKD-EPI 2021) ≥ 60')).toEqual(['CKD-EPI'])
    expect(gfrFormulas('TFG por MDRD')).toEqual(['MDRD'])
    expect(gfrFormulas('eGFR por cistatina C o CKD EPI')).toEqual(['CKD-EPI', 'cistatina'])
    expect(gfrFormulas('eGFR ≥ 60')).toEqual([])
  })
})

describe('el motor no compara el filtrado estimado con un criterio de aclaramiento', () => {
  it('criterio de inclusión con Cockcroft-Gault: a revisar, aunque el filtrado registrado lo «cumpliría»', () => {
    const [result] = assessScreening(profile([EGFR]), inclusion('TFG estimada por Cockcroft-Gault ≥ 60 mL/min.'))
    expect(result?.status).toBe('unknown')
    expect(result?.reason).toMatch(/aclaramiento de creatinina/)
    expect(result?.reason).toMatch(/verificar a mano/i)
  })

  it('criterio de exclusión con aclaramiento: a revisar, aunque el filtrado registrado no lo «activaría»', () => {
    const [result] = assessScreening(profile([EGFR]), exclusion('eGFR o aclaramiento de creatinina < 30 mL/min.'))
    expect(result?.status).toBe('unknown')
  })

  it('un aclaramiento cargado en el perfil no se toma como filtrado estimado', () => {
    const [result] = assessScreening(
      profile([{ name: 'TFG (Cockcroft-Gault)', value: 72, unit: 'mL/min' }]),
      inclusion('eGFR ≥ 60 mL/min/1,73 m².'),
    )
    expect(result?.status).toBe('unknown')
    expect(result?.missing).toEqual(['egfr'])
  })

  it('si hay un aclaramiento y un filtrado estimado, se compara el filtrado', () => {
    const [result] = assessScreening(
      profile([{ name: 'TFG (Cockcroft-Gault)', value: 40, unit: 'mL/min' }, EGFR]),
      inclusion('eGFR ≥ 60 mL/min/1,73 m².'),
    )
    expect(result?.status).toBe('pass')
    expect(result?.reason).toContain('72,0')
  })
})

describe('fórmulas del filtrado estimado', () => {
  it('el criterio pide una fórmula y el laboratorio dice otra: a revisar', () => {
    const [result] = assessScreening(
      profile([{ name: 'eGFR (MDRD)', value: 72, unit: 'mL/min' }]),
      inclusion('eGFR (CKD-EPI) ≥ 60 mL/min/1,73 m².'),
    )
    expect(result?.status).toBe('unknown')
    expect(result?.reason).toMatch(/CKD-EPI/)
    expect(result?.reason).toMatch(/MDRD/)
  })

  it('el criterio pide una fórmula y el laboratorio no dice cuál usó: compara y lo avisa', () => {
    const [result] = assessScreening(profile([EGFR]), inclusion('eGFR (CKD-EPI) ≥ 60 mL/min/1,73 m².'))
    expect(result?.status).toBe('pass')
    expect(result?.reason).toMatch(/no dice con qué fórmula/)
  })

  it('misma fórmula en los dos: compara sin aviso', () => {
    const [result] = assessScreening(
      profile([{ name: 'eGFR CKD-EPI', value: 72, unit: 'mL/min' }]),
      inclusion('eGFR (CKD-EPI) ≥ 60 mL/min/1,73 m².'),
    )
    expect(result?.status).toBe('pass')
    expect(result?.reason).not.toMatch(/fórmula/)
  })

  it('sin fórmula en el criterio, el comportamiento no cambia', () => {
    const [pass] = assessScreening(profile([EGFR]), inclusion('eGFR ≥ 60 mL/min/1,73 m².'))
    expect(pass?.status).toBe('pass')
    expect(pass?.reason).not.toMatch(/fórmula/)
    const [fail] = assessScreening(profile([{ ...EGFR, value: 41 }]), inclusion('eGFR ≥ 60 mL/min/1,73 m².'))
    expect(fail?.status).toBe('fail')
  })
})

describe('lectura de un informe de laboratorio', () => {
  it('un aclaramiento de creatinina no se propone como creatinina ni como filtrado', () => {
    const { labs } = parseLabOcrText('Clearance de creatinina: 85 mL/min\nTFG (Cockcroft-Gault): 78 mL/min')
    expect(labs.find((lab) => lab.name === 'Creatinina')).toBeUndefined()
    expect(labs.find((lab) => lab.name === 'eGFR')).toBeUndefined()
  })

  it('la creatinina y el filtrado estimado se siguen leyendo, también junto a un aclaramiento', () => {
    const { labs } = parseLabOcrText('Creatinina: 0,9 mg/dL\nClearance de creatinina: 85 mL/min\nFiltrado glomerular: 91 mL/min/1,73m2')
    expect(labs.find((lab) => lab.name === 'Creatinina')?.value).toBe(0.9)
    expect(labs.find((lab) => lab.name === 'eGFR')?.value).toBe(91)
  })
})
