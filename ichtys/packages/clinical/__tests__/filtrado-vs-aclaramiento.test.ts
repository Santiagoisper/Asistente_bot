import { describe, expect, it } from 'vitest'
import { assessScreening } from '../screening-engine'
import { parseLabOcrText } from '../lab-ocr-parser'
import { gfrFormulas, mentionsCreatinineClearance, mentionsMeasuredGfr } from '../numeric-criteria'
import type { PatientProfile } from '../profile-schema'

/**
 * El filtrado glomerular estimado y el aclaramiento de creatinina son dos medidas distintas.
 * El motor solo sabe comparar la primera. Si el criterio o el laboratorio nombran la otra (o el
 * filtrado medido), si nombran fórmulas que no coinciden, o si el criterio pide una fórmula y el
 * laboratorio no dice cuál usó, el resultado es «a revisar», nunca verde ni rojo.
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

  // Formas que se escapaban en la primera versión (revisión de Architect en el #213).
  it.each([
    'TFG por Cockroft-Gault ≥ 60 mL/min',
    'Cockcroff-Gault',
    'fórmula de Cockcrof',
    'Cockcroft & Gault',
    'eCrCl ≥ 50 mL/min',
    'CCr ≥ 60',
    'Cl Cr ≥ 60',
    'Cl-Cr ≥ 60',
    'Cr Cl ≥ 60',
    'CLcr ≥ 60',
    'CrCL ≥ 60',
    'clearance of creatinine ≥ 60',
    'creatinine CL ≥ 60',
    'aclaramiento renal de creatinina ≥ 60',
    'aclaramiento estimado de creatinina ≥ 60',
    'depuración renal calculada de creatinina',
    'aclaramiento creatinínico ≥ 60',
    'clearance de creatinina endógena',
    'depuração de creatinina ≥ 60',
    'Depuração da creatinina: 85',
    'aclaramento de creatinina',
    'Kreatinin-Clearance',
    'clairance de la créatinine',
  ])('«%s» nombra el aclaramiento', (text) => {
    expect(mentionsCreatinineClearance(text)).toBe(true)
  })

  it.each([
    'TFG (CKD-EPI) ≥ 45',
    'Cloruro (Cl) 102 mEq/L',
    'Cr 1,1 mg/dL',
    'Ca, Cl y Cr en rango',
    'Na, K, Cl, Cr dentro del rango',
    'creatinina clínicamente estable',
    'TFG estimada ≥ 60 mL/min/1,73 m²',
  ])('«%s» no nombra el aclaramiento', (text) => {
    expect(mentionsCreatinineClearance(text)).toBe(false)
  })

  it.each([
    'TFG medida ≥ 60 mL/min',
    'filtrado glomerular medido con iohexol',
    'mGFR ≥ 60',
    'measured GFR ≥ 60',
    'TFG por aclaramiento de iotalamato',
    'GFR (iothalamate)',
    'TFG por inulina',
  ])('«%s» nombra el filtrado medido', (text) => {
    expect(mentionsMeasuredGfr(text)).toBe(true)
  })

  it.each(['eGFR ≥ 60 mL/min/1,73 m²', 'TFG estimada (CKD-EPI) ≥ 45', 'Filtrado glomerular estimado', 'la medida de la TFG', 'TFG ≥ 60 en tratamiento con insulina'])(
    '«%s» no nombra el filtrado medido',
    (text) => {
      expect(mentionsMeasuredGfr(text)).toBe(false)
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

  const CLEARANCE_REASON =
    'El criterio nombra el aclaramiento de creatinina (por ejemplo, Cockcroft-Gault). El sistema solo compara el filtrado glomerular estimado y no los trata como la misma medida: verificar a mano.'
  const MEASURED_REASON =
    'El criterio nombra el filtrado glomerular medido (por ejemplo, con iohexol). El sistema solo compara el filtrado glomerular estimado y no los trata como la misma medida: verificar a mano.'

  // El escape que importa: el nombre viene junto a una palabra de filtrado, y ese criterio el motor sí lo evalúa.
  it.each([
    'TFG por Cockroft-Gault ≥ 60 mL/min.',
    'TFG (Cockcroff-Gault) ≥ 60 mL/min.',
    'eGFR o eCrCl ≥ 60 mL/min.',
    'TFG (Cl Cr) ≥ 60 mL/min.',
    'TFG (CCr) ≥ 60 mL/min.',
    'TFG o aclaramiento renal de creatinina ≥ 60 mL/min.',
    'TFG o aclaramiento estimado de creatinina ≥ 60 mL/min.',
    'eGFR or creatinine CL ≥ 60 mL/min.',
    'TFG ou depuração da creatinina ≥ 60 mL/min.',
  ])('inclusión «%s»: a revisar, con el filtrado registrado por encima y por debajo del corte', (text) => {
    for (const value of [72, 41]) {
      const [result] = assessScreening(profile([{ ...EGFR, value }]), inclusion(text))
      expect(result?.status).toBe('unknown')
      expect(result?.reason).toBe(CLEARANCE_REASON)
    }
  })

  it.each(['TFG medida (iohexol) ≥ 60 mL/min.', 'TFG medida ≥ 60 mL/min.', 'eGFR o mGFR ≥ 60 mL/min.', 'TFG por aclaramiento de iotalamato ≥ 60 mL/min.'])(
    'inclusión «%s»: el filtrado medido tampoco se compara con el estimado',
    (text) => {
      for (const value of [72, 41]) {
        const [result] = assessScreening(profile([{ ...EGFR, value }]), inclusion(text))
        expect(result?.status).toBe('unknown')
        expect(result?.reason).toBe(MEASURED_REASON)
      }
    },
  )

  it('exclusión por filtrado medido: a revisar, lo active o no el filtrado estimado', () => {
    for (const value of [72, 20]) {
      const [result] = assessScreening(profile([{ ...EGFR, value }]), exclusion('TFG medida < 30 mL/min.'))
      expect(result?.status).toBe('unknown')
      expect(result?.reason).toBe(MEASURED_REASON)
    }
  })

  it.each(['TFG (Cockroft-Gault)', 'TFG por eCrCl', 'TFG medida (iohexol)', 'mGFR / TFG'])(
    'un laboratorio cargado como «%s» no se toma como filtrado estimado',
    (name) => {
      const [result] = assessScreening(profile([{ name, value: 72, unit: 'mL/min' }]), inclusion('eGFR ≥ 60 mL/min/1,73 m².'))
      expect(result?.status).toBe('unknown')
      expect(result?.reason).toBe('eGFR no documentado en el perfil del sujeto.')
      expect(result?.missing).toEqual(['egfr'])
    },
  )

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

  const UNSTATED_REASON =
    'El criterio pide el filtrado estimado con CKD-EPI y el laboratorio registrado no dice con qué fórmula se estimó: no se sabe si es la medida que pide el criterio. Verificar a mano.'

  // «Cumple» quiere decir que se comparó la medida que el criterio pide. Sin la fórmula del
  // laboratorio no se sabe, y un dato ausente no es un verde (revisión de Architect en el #213).
  it('el criterio pide una fórmula y el laboratorio no dice cuál usó: a revisar, cumpla o no el valor', () => {
    for (const value of [72, 41]) {
      const [result] = assessScreening(profile([{ ...EGFR, value }]), inclusion('eGFR (CKD-EPI) ≥ 60 mL/min/1,73 m².'))
      expect(result?.status).toBe('unknown')
      expect(result?.reason).toBe(UNSTATED_REASON)
      expect(result?.missing).toBeUndefined()
    }
  })

  it('lo mismo en un criterio de exclusión: a revisar, lo active o no el valor', () => {
    for (const value of [72, 20]) {
      const [result] = assessScreening(profile([{ ...EGFR, value }]), exclusion('eGFR (CKD-EPI) < 30 mL/min/1,73 m².'))
      expect(result?.status).toBe('unknown')
      expect(result?.reason).toBe(UNSTATED_REASON)
    }
  })

  // El mismo perfil no puede dar otro resultado según el orden de sus laboratorios (hallazgo de Devin en el #213).
  describe('más de un filtrado estimado en el perfil', () => {
    const MDRD = (value: number) => ({ name: 'eGFR (MDRD)', value, unit: 'mL/min' })
    const CKD = (value: number) => ({ name: 'eGFR (CKD-EPI)', value, unit: 'mL/min' })
    const CYS = (value: number) => ({ name: 'eGFR por cistatina C', value, unit: 'mL/min' })
    const bothOrders = (a: PatientProfile['labs'][number], b: PatientProfile['labs'][number]) => [
      [a, b],
      [b, a],
    ]

    it('se compara el que dice la fórmula pedida, esté primero o segundo', () => {
      for (const labs of bothOrders(MDRD(40), CKD(72))) {
        const [result] = assessScreening(profile(labs), inclusion('eGFR (CKD-EPI) ≥ 60 mL/min/1,73 m².'))
        expect(result?.status).toBe('pass')
        expect(result?.reason).toContain('72,0')
        expect(result?.reason).not.toContain('40,0')
      }
      for (const labs of bothOrders(MDRD(72), CKD(40))) {
        const [result] = assessScreening(profile(labs), inclusion('eGFR (CKD-EPI) ≥ 60 mL/min/1,73 m².'))
        expect(result?.status).toBe('fail')
        expect(result?.reason).toContain('40,0')
      }
    })

    it('uno sin fórmula y otro con la pedida: vale el de la fórmula pedida', () => {
      for (const labs of bothOrders({ ...EGFR, value: 72 }, CKD(40))) {
        const [result] = assessScreening(profile(labs), inclusion('eGFR (CKD-EPI) ≥ 60 mL/min/1,73 m².'))
        expect(result?.status).toBe('fail')
        expect(result?.reason).toContain('40,0')
      }
    })

    it('el criterio admite dos fórmulas: vale el laboratorio que dice una de ellas', () => {
      for (const labs of bothOrders(CYS(41), MDRD(72))) {
        const [result] = assessScreening(profile(labs), inclusion('eGFR (CKD-EPI o MDRD) ≥ 60 mL/min/1,73 m².'))
        expect(result?.status).toBe('pass')
        expect(result?.reason).toContain('72,0')
      }
    })

    it('ninguno dice la fórmula pedida: a revisar, y el motivo nombra las que hay', () => {
      for (const labs of bothOrders(MDRD(72), CYS(72))) {
        const [result] = assessScreening(profile(labs), inclusion('eGFR (CKD-EPI) ≥ 60 mL/min/1,73 m².'))
        expect(result?.status).toBe('unknown')
        expect(result?.reason).toBe(
          'El criterio pide el filtrado estimado con CKD-EPI y el laboratorio registrado dice MDRD y cistatina: no se comparan. Verificar a mano.',
        )
      }
    })

    it('uno con otra fórmula y otro sin fórmula: a revisar', () => {
      for (const labs of bothOrders(MDRD(72), { ...EGFR, value: 72 })) {
        const [result] = assessScreening(profile(labs), inclusion('eGFR (CKD-EPI) ≥ 60 mL/min/1,73 m².'))
        expect(result?.status).toBe('unknown')
        expect(result?.reason).toBe(
          'El criterio pide el filtrado estimado con CKD-EPI y el laboratorio registrado dice MDRD: no se comparan. Verificar a mano.',
        )
      }
    })
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

  // Formas que el lector todavía proponía como creatinina en mg/dL (revisión de Architect en el #213).
  it.each([
    'Aclaramiento renal de creatinina: 85',
    'Depuração da creatinina: 85',
    'Aclaramiento estimado de creatinina: 85 mL/min',
    'Depuración de creatinina 85',
    'Clearance creatinina 24 hs: 85',
    'Clairance de la creatinina: 85',
  ])('«%s» no se propone como creatinina', (line) => {
    const { labs } = parseLabOcrText(line)
    expect(labs.find((lab) => lab.name === 'Creatinina')).toBeUndefined()
  })

  it.each([
    'TFG: 78 mL/min (Cockcroft-Gault)',
    'eGFR 78 mL/min por Cockroft',
    'Filtrado glomerular: 78 mL/min (CrCl)',
    'Filtrado glomerular: 78 mL/min (iohexol)',
  ])('«%s» no se propone como filtrado estimado', (line) => {
    const { labs } = parseLabOcrText(line)
    expect(labs.find((lab) => lab.name === 'eGFR')).toBeUndefined()
  })

  it('el renglón del aclaramiento no tapa a la creatinina ni al filtrado de los otros renglones, en cualquier orden', () => {
    const lines = ['Aclaramiento renal de creatinina: 85 mL/min', 'Creatinina: 0,9 mg/dL', 'TFG: 78 mL/min (Cockcroft-Gault)', 'Filtrado glomerular: 91 mL/min/1,73m2']
    for (const text of [lines.join('\n'), [...lines].reverse().join('\n')]) {
      const { labs } = parseLabOcrText(text)
      expect(labs.find((lab) => lab.name === 'Creatinina')?.value).toBe(0.9)
      expect(labs.find((lab) => lab.name === 'eGFR')?.value).toBe(91)
    }
  })

  it('aclaramiento y creatinina en el mismo renglón: se lee la creatinina', () => {
    const { labs } = parseLabOcrText('Clearance de creatinina: 85 mL/min   Creatinina: 0,9 mg/dL')
    expect(labs.find((lab) => lab.name === 'Creatinina')?.value).toBe(0.9)
  })

  it('la creatinina y el filtrado estimado se siguen leyendo, también junto a un aclaramiento', () => {
    const { labs } = parseLabOcrText('Creatinina: 0,9 mg/dL\nClearance de creatinina: 85 mL/min\nFiltrado glomerular: 91 mL/min/1,73m2')
    expect(labs.find((lab) => lab.name === 'Creatinina')?.value).toBe(0.9)
    expect(labs.find((lab) => lab.name === 'eGFR')?.value).toBe(91)
  })
})

describe('«tasa de filtración glomerular estimada» en un criterio (recorrido 19/11, R-09)', () => {
  const criterion = 'Tasa de filtración glomerular estimada menor a 30 mL/min/1,73 m2.'
  it('con eGFR 88 la exclusión no excluye', () => {
    const [result] = assessScreening(profile([{ name: 'eGFR', value: 88, unit: 'mL/min/1.73m2' }]), exclusion(criterion))
    expect(result?.status).toBe('pass')
  })
  it('con eGFR 25 excluye', () => {
    const [result] = assessScreening(profile([{ name: 'eGFR', value: 25, unit: 'mL/min/1.73m2' }]), exclusion(criterion))
    expect(result?.status).toBe('fail')
  })
  it('sin el dato queda a revisar', () => {
    const [result] = assessScreening(profile([]), exclusion(criterion))
    expect(result?.status).toBe('unknown')
  })
})
