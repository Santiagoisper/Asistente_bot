/**
 * Lo que el médico dice de forma expresa llega a la elegibilidad (paquete «resolver criterios»).
 * Regla que cruza todo el archivo: un verde es una afirmación comprobada; lo que no se dijo o
 * no se midió queda a revisar, y lo negado solo cuenta si la negación es pura.
 */
import { describe, expect, it } from 'vitest'
import { extractFactsFromEvolution, mergeProfileWithFacts } from '../extract-facts'
import { mergeExtractions } from '../extract-merge'
import { emptyPatientProfile, type PatientProfile } from '../profile-schema'
import { assessScreening } from '../screening-engine'

const lab = (facts: ReturnType<typeof extractFactsFromEvolution>, name: string) => facts.labs.find((item) => item.name === name)
const profileWith = (overrides: Partial<PatientProfile>): PatientProfile => ({ version: 1, labs: [], medications: [], conditions: [], ...overrides })
const inclusion = (profile: PatientProfile, text: string) => assessScreening(profile, { inclusionCriteria: [{ number: '1', text }], exclusionCriteria: [] })[0]!
const exclusion = (profile: PatientProfile, text: string) => assessScreening(profile, { inclusionCriteria: [], exclusionCriteria: [{ number: '1', text }] })[0]!

describe('extracción: lo dicho de forma expresa', () => {
  it.each([
    'Sin insulina.',
    'No recibe insulina ni metformina.',
    'Suspendió la metformina hace un mes.',
    'Niega uso de insulina.',
  ])('una medicación negada no se propone como medicación actual: %s', (text) => {
    expect(extractFactsFromEvolution(text).medications).toEqual([])
  })

  it.each([
    'Sin cambios en metformina 850 mg.',
    'Sin intolerancia a la metformina.',
    'No presenta efectos adversos con metformina.',
    'Sin insulina. Metformina 850 mg cada 12 h.',
    'Suspendió la insulina, sigue con metformina.',
  ])('negar otra cosa no niega la medicación: %s', (text) => {
    expect(extractFactsFromEvolution(text).medications.map((medication) => medication.name)).toEqual(['Metformina'])
  })

  it('una medicación negada primero y afirmada después se propone', () => {
    expect(extractFactsFromEvolution('Sin insulina hasta 2024. Hoy insulina glargina.').medications.map((medication) => medication.name)).toEqual(['Insulina'])
  })

  it('la negación de una cosa no niega la medicación del tramo siguiente', () => {
    const facts = extractFactsFromEvolution('Sin insulina, metformina 850 mg cada 12 h.')
    expect(facts.medications.map((medication) => medication.name)).toEqual(['Metformina'])
  })

  it('antecedentes: lo negado sale como «Sin …» y lo afirmado como antecedente', () => {
    expect(extractFactsFromEvolution('Sin antecedentes de pancreatitis. Niega embarazo. No amamanta.').conditions).toEqual([
      'Sin antecedentes de pancreatitis',
      'Sin embarazo',
      'Sin lactancia',
    ])
    expect(extractFactsFromEvolution('Antecedente de pancreatitis aguda en 2019. Cursa embarazo de 12 semanas.').conditions).toEqual([
      'Antecedente de pancreatitis',
      'Embarazo en curso',
    ])
    expect(extractFactsFromEvolution('Sin embarazo ni lactancia.').conditions).toEqual(['Sin embarazo', 'Sin lactancia'])
    expect(extractFactsFromEvolution('Paciente de 58 años, sin antecedentes de pancreatitis.').conditions).toEqual(['Sin antecedentes de pancreatitis'])
    expect(extractFactsFromEvolution('No está embarazada. No amamanta.').conditions).toEqual(['Sin embarazo', 'Sin lactancia'])
    expect(extractFactsFromEvolution('Sin fiebre, pancreatitis crónica.').conditions).toEqual(['Antecedente de pancreatitis'])
    // Una lista de negaciones separadas por coma: cada una vale porque lo que sigue también niega.
    expect(extractFactsFromEvolution('Sin antecedentes de pancreatitis, sin embarazo, sin lactancia.').conditions).toEqual([
      'Sin antecedentes de pancreatitis',
      'Sin embarazo',
      'Sin lactancia',
    ])
  })

  it.each([
    'Se solicita test de embarazo.',
    'Se explica el riesgo de pancreatitis del fármaco.',
    // El resultado de un test no es lo que el médico afirma del estado: queda a revisar.
    'Test de embarazo en orina negativo.',
    // Niega otra cosa; la pancreatitis queda nombrada pero ni afirmada ni negada de forma expresa.
    'Sin dolor abdominal por la pancreatitis de 2019.',
    'No tuvo pancreatitis.',
    // La frase sigue después de la negación: lo que sigue puede desdecirla.
    'Niega pancreatitis, pero tuvo una en 2019.',
    'Sin antecedentes de pancreatitis, salvo un episodio leve en 2015.',
    'Sin pancreatitis, tuvo una internación por dolor abdominal.',
    // Hallazgo de Reviewer (#136): que hoy no haya signos no dice nada del antecedente.
    'Sin signos de pancreatitis.',
    'Sin signos de embarazo.',
    // El antecedente es historia: «no presenta» o «no cursa» hablan de hoy.
    'No presenta pancreatitis.',
    'No cursa pancreatitis.',
    // El embarazo es un estado: negar la historia no lo niega.
    'Sin antecedentes de embarazo.',
    // «Sin embarazos previos» habla de la historia, no del estado actual.
    'Sin embarazos previos.',
    'Sin embarazo previo.',
    'Sin lactancia previa.',
  ])('lo que no se dice de forma expresa no se anota: %s', (text) => {
    expect(extractFactsFromEvolution(text).conditions).toEqual([])
  })

  it.each([
    ['Diabetes hace 10 años.', undefined],
    ['Metformina desde hace 2 años.', undefined],
    ['Tratamiento estable durante 3 años.', undefined],
    ['DM2 de 6 años de evolución. Paciente de 58 años.', 58],
    ['Diagnóstico hace 6 años, mujer de 45 años.', 45],
    ['Edad: 52 años.', 52],
    ['paciente que tiene 52 años', 52],
    ['Paciente masculino, 58 años, consulta por control.', 58],
    ['58 años de edad.', 58],
    ['Paciente de 158 años.', undefined],
    ['Paciente con hipertensión de 20 años.', undefined],
    ['Diabetes tipo 2, 10 años, en tratamiento.', undefined],
    ['Fuma desde los 20 años de edad.', undefined],
    ['La enfermedad tiene 10 años.', undefined],
    ['Diagnóstico a los 40 años de edad. Paciente de 58 años.', 58],
    ['Tiene 58 años.', 58],
    ['Paciente femenina de 61 años.', 61],
  ])('la edad solo sale de una frase que habla de la edad: %s', (text, expected) => {
    expect(extractFactsFromEvolution(text).ageYears).toBe(expected)
  })

  it('una fecha no es una presión arterial, y una presión imposible no se anota', () => {
    expect(extractFactsFromEvolution('Control el 12/11/2026.').systolic).toBeUndefined()
    expect(extractFactsFromEvolution('Próxima visita 14/12.').systolic).toBeUndefined()
    expect(extractFactsFromEvolution('TA 84/132.').systolic).toBeUndefined()
    expect(extractFactsFromEvolution('TA 132/84 mmHg.')).toMatchObject({ systolic: 132, diastolic: 84 })
    expect(extractFactsFromEvolution('Presión arterial 132 sobre 84.')).toMatchObject({ systolic: 132, diastolic: 84 })
  })

  it.each(['Bajó de peso 12 kilos.', 'Aumento de peso de 10 kg en un año.', 'Peso 8 kg.'])('un cambio de peso no es el peso: %s', (text) => {
    expect(lab(extractFactsFromEvolution(text), 'Peso')).toBeUndefined()
  })

  it('una HbA1c imposible no se anota', () => {
    expect(lab(extractFactsFromEvolution('HbA1c 79%.'), 'HbA1c')).toBeUndefined()
    expect(lab(extractFactsFromEvolution('HbA1c de 3 meses atrás, pendiente la actual.'), 'HbA1c')).toBeUndefined()
  })

  it('peso, talla e IMC, escritos o dictados', () => {
    const written = extractFactsFromEvolution('Peso 78 kg, talla 1,63 m, IMC 29,4 kg/m².')
    expect(lab(written, 'Peso')).toMatchObject({ value: 78, unit: 'kg' })
    expect(lab(written, 'Talla')).toMatchObject({ value: 163, unit: 'cm' })
    expect(lab(written, 'IMC')).toMatchObject({ value: 29.4, unit: 'kg/m2' })
    const spoken = extractFactsFromEvolution('Peso 78 kilos. Talla 1 metro 63. Índice de masa corporal 29 coma 4.')
    expect(lab(spoken, 'Peso')?.value).toBe(78)
    expect(lab(spoken, 'Talla')?.value).toBe(163)
    expect(lab(spoken, 'IMC')?.value).toBe(29.4)
    expect(lab(extractFactsFromEvolution('Talla 163 cm.'), 'Talla')?.value).toBe(163)
  })

  it('una talla imposible no se anota', () => {
    expect(lab(extractFactsFromEvolution('Talla 9,5 m.'), 'Talla')).toBeUndefined()
  })

  it('la HbA1c dictada con su nombre largo, con coma dicha o con «por ciento»', () => {
    expect(lab(extractFactsFromEvolution('Hemoglobina glicosilada 7 coma 9 por ciento.'), 'HbA1c')).toMatchObject({ value: 7.9, unit: '%' })
    expect(lab(extractFactsFromEvolution('Hemoglobina glicada de 8,1%.'), 'HbA1c')?.value).toBe(8.1)
    expect(lab(extractFactsFromEvolution('HbA1c 8%.'), 'HbA1c')?.value).toBe(8)
  })
})

describe('elegibilidad: IMC', () => {
  const criterion = 'Indice de masa corporal entre 23 y 40 kg/m2.'

  it('con el IMC registrado', () => {
    const result = inclusion(profileWith({ labs: [{ name: 'IMC', value: 29.4, unit: 'kg/m2' }] }), criterion)
    expect(result.status).toBe('pass')
    expect(result.reason).toMatch(/^IMC 29,4/)
  })

  it('sin IMC, lo calcula con peso y talla y lo dice', () => {
    const result = inclusion(profileWith({ labs: [{ name: 'Peso', value: 78, unit: 'kg' }, { name: 'Talla', value: 163, unit: 'cm' }] }), criterion)
    expect(result.status).toBe('pass')
    expect(result.reason).toContain('calculado con peso 78,0 kg y talla 163,0 cm')
  })

  it('fuera de rango no pasa', () => {
    expect(inclusion(profileWith({ labs: [{ name: 'IMC', value: 41.2, unit: 'kg/m2' }] }), criterion).status).toBe('fail')
    expect(inclusion(profileWith({ labs: [{ name: 'Peso', value: 50, unit: 'kg' }, { name: 'Talla', value: 170, unit: 'cm' }] }), criterion).status).toBe('fail')
  })

  it('con un peso o una talla imposibles no calcula nada', () => {
    const result = inclusion(profileWith({ labs: [{ name: 'Peso', value: 78, unit: 'kg' }, { name: 'Talla', value: 16.3, unit: 'cm' }] }), criterion)
    expect(result.status).toBe('unknown')
  })

  it('sin datos, o con solo el peso, queda a revisar', () => {
    expect(inclusion(emptyPatientProfile(), criterion).status).toBe('unknown')
    const onlyWeight = inclusion(profileWith({ labs: [{ name: 'Peso', value: 78, unit: 'kg' }] }), criterion)
    expect(onlyWeight.status).toBe('unknown')
    expect(onlyWeight.reason).toMatch(/peso y la talla/)
  })
})

describe('elegibilidad: embarazo o lactancia', () => {
  const criterion = 'Embarazo o lactancia.'
  const status = (conditions: string[]) => exclusion(profileWith({ conditions }), criterion).status

  it('sin nada dicho queda a revisar, y el motivo dice qué falta decir', () => {
    const result = exclusion(emptyPatientProfile(), criterion)
    expect(result.status).toBe('unknown')
    expect(result.reason).toContain('sin embarazo ni lactancia')
  })

  it('negar una sola de las dos no alcanza', () => {
    expect(status(['Sin embarazo'])).toBe('unknown')
    expect(exclusion(profileWith({ conditions: ['Sin embarazo'] }), criterion).reason).toMatch(/no registra lactancia/)
  })

  it('negadas las dos, se despeja: en dos frases o en una', () => {
    expect(status(['Sin embarazo', 'Sin lactancia'])).toBe('pass')
    expect(status(['Sin embarazo ni lactancia'])).toBe('pass')
  })

  it('una afirmada la activa aunque la otra esté negada', () => {
    expect(status(['Sin embarazo', 'Lactancia en curso'])).toBe('fail')
    expect(status(['Embarazo en curso'])).toBe('fail')
  })
})

describe('elegibilidad: el criterio pide algo que el sistema no comprueba', () => {
  const allDenied = profileWith({ conditions: ['Sin antecedentes de pancreatitis', 'Sin embarazo', 'Sin lactancia'] })

  it.each([
    'Antecedente de pancreatitis o de carcinoma medular de tiroides.',
    'Embarazo, lactancia o intención de embarazo durante el estudio.',
    'Pancreatitis en los últimos 5 años.',
    'Pregnant, breastfeeding, or planning to become pregnant during the study.',
    'History of pancreatitis or medullary thyroid carcinoma.',
  ])('no pasa aunque lo que sí comprueba esté negado: %s', (text) => {
    const result = exclusion(allDenied, text)
    expect(result.status).toBe('unknown')
    expect(result.reason).toMatch(/además/)
  })

  it('y lo afirmado tampoco la activa sola: el criterio puede acotarlo («en los últimos 5 años»)', () => {
    const result = exclusion(profileWith({ conditions: ['Antecedente de pancreatitis'] }), 'Pancreatitis en los últimos 5 años.')
    expect(result.status).toBe('unknown')
    expect(result.reason).toContain('Registrado en el perfil: pancreatitis')
  })

  it.each([
    'Embarazo o lactancia.',
    'Mujeres embarazadas o en período de lactancia.',
    'Antecedentes de pancreatitis aguda o crónica.',
    'Historia de pancreatitis',
    'History of any pancreatitis (acute or chronic) at any time prior to enrollment.',
    'Women who are pregnant or breast-feeding.',
  ])(
    'una redacción que no pide nada más sí se despeja: %s',
    (text) => {
      expect(exclusion(allDenied, text).status).toBe('pass')
    },
  )
})

describe('elegibilidad: historia y estado no se niegan con las mismas palabras (hallazgo de Reviewer, #136)', () => {
  const pancreatitis = (condition: string) => exclusion(profileWith({ conditions: [condition] }), 'Antecedente de pancreatitis.').status
  const pregnancy = (condition: string) => exclusion(profileWith({ conditions: [condition, 'Sin lactancia'] }), 'Embarazo o lactancia.').status

  it.each(['Sin signos de pancreatitis', 'No presenta pancreatitis', 'No cursa pancreatitis', 'No tiene pancreatitis'])(
    'no despeja un antecedente: %s',
    (condition) => {
      expect(pancreatitis(condition)).not.toBe('pass')
    },
  )

  it.each(['Sin antecedentes de pancreatitis', 'Niega pancreatitis', 'No refiere pancreatitis', 'No presenta antecedentes de pancreatitis', 'Sin episodios de pancreatitis'])(
    'sí lo despeja: %s',
    (condition) => {
      expect(pancreatitis(condition)).toBe('pass')
    },
  )

  it.each(['Sin signos de embarazo', 'Sin antecedentes de embarazo', 'Sin historia de embarazo'])('no despeja un estado: %s', (condition) => {
    expect(pregnancy(condition)).not.toBe('pass')
  })

  it.each(['Sin embarazo', 'No está embarazada', 'No cursa embarazo', 'Niega embarazo'])('sí lo despeja: %s', (condition) => {
    expect(pregnancy(condition)).toBe('pass')
  })

  it('un criterio sobre la historia de un estado pide más de lo que el sistema comprueba', () => {
    const denied = profileWith({ conditions: ['Sin embarazo', 'Sin lactancia'] })
    expect(exclusion(denied, 'Embarazo previo.').status).toBe('unknown')
    expect(exclusion(denied, 'Antecedente de embarazo ectópico.').status).toBe('unknown')
  })
})

describe('elegibilidad: negar la historia no es negar el estado', () => {
  const criterion = 'Embarazo o lactancia.'
  it.each([
    [['Sin embarazo previo', 'Sin lactancia'], 'fail'],
    [['Sin embarazo', 'Sin lactancia previa'], 'fail'],
    // Una diabetes gestacional pasada no es un embarazo.
    [['Sin embarazo', 'Sin lactancia', 'Antecedente de diabetes gestacional'], 'pass'],
  ] as const)('%j → %s', (conditions, expected) => {
    expect(exclusion(profileWith({ conditions: [...conditions] }), criterion).status).toBe(expected)
  })
})

describe('elegibilidad: la negación tiene que ser pura', () => {
  const criterion = 'Antecedente de pancreatitis.'
  it.each(['Sin dolor por pancreatitis previa', 'Sin fiebre, pancreatitis crónica', 'Sin controles desde la pancreatitis'])('no despeja: %s', (condition) => {
    expect(exclusion(profileWith({ conditions: [condition] }), criterion).status).toBe('fail')
  })
})

describe('de la visita de selección dictada a los criterios', () => {
  const PROTOCOL = {
    inclusionCriteria: [
      { number: '2.1', text: 'Adultos de 18 a 75 anos de edad.' },
      { number: '2.2', text: 'HbA1c entre 7,0 % y 10,5 % en la visita de seleccion.' },
      { number: '2.3', text: 'Indice de masa corporal entre 23 y 40 kg/m2.' },
      { number: '2.4', text: 'Tratamiento estable con metformina durante al menos 90 dias.' },
    ],
    exclusionCriteria: [
      { number: '3.1', text: 'Tasa de filtrado glomerular estimada menor de 45 mL/min/1,73 m2.' },
      { number: '3.2', text: 'ALT o AST mayor a 3 veces el limite superior normal.' },
      { number: '3.3', text: 'Antecedente de pancreatitis.' },
      { number: '3.4', text: 'Embarazo o lactancia.' },
    ],
  }
  const dictated =
    'Visita de selección. Paciente de 58 años. Medicación actual: metformina 850 mg cada 12 horas. Sin insulina. ' +
    'Signos vitales: presión arterial 132 sobre 84. Peso 78 kilos. Talla 1 metro 63. ' +
    'Sin antecedentes de pancreatitis. Sin embarazo ni lactancia. Laboratorio: hemoglobina glicosilada 7 coma 9 por ciento.'

  it('resuelve lo que se dijo y deja a revisar, con su motivo, lo que no se puede comprobar', () => {
    const facts = extractFactsFromEvolution(dictated)
    const profile = mergeProfileWithFacts(emptyPatientProfile(), facts, '00000000-0000-4000-8000-000000000001')
    const byNumber = Object.fromEntries(assessScreening(profile, PROTOCOL).map((item) => [item.criterionNumber, item.status]))
    expect(byNumber).toEqual({
      '2.1': 'pass', // edad
      '2.2': 'pass', // HbA1c dictada
      '2.3': 'pass', // IMC calculado con peso y talla
      '2.4': 'unknown', // metformina: los 90 días no están comprobados
      '3.1': 'unknown', // filtrado: falta el laboratorio
      '3.2': 'unknown', // transaminasas: todavía sin regla
      '3.3': 'pass', // pancreatitis negada
      '3.4': 'pass', // embarazo y lactancia negados
    })
    expect(profile.medications.map((medication) => medication.name)).toEqual(['Metformina'])
  })
})

describe('lo que propone el modelo no despeja una exclusión', () => {
  const none = { labs: [], medications: [], conditions: [] as string[] }

  it('una negación de antecedente que solo trae el modelo no se propone; una afirmación sí', () => {
    const merged = mergeExtractions(none, {
      ...none,
      conditions: ['Sin antecedentes de pancreatitis', 'Sin embarazo ni lactancia', 'Antecedente de pancreatitis', 'DM2'],
    })
    expect(merged.facts.conditions).toEqual(['Antecedente de pancreatitis', 'DM2'])
  })

  it('si las reglas también la leyeron, queda', () => {
    const merged = mergeExtractions({ ...none, conditions: ['Sin antecedentes de pancreatitis'] }, { ...none, conditions: ['Niega pancreatitis', 'Sin embarazo'] })
    expect(merged.facts.conditions).toEqual(['Sin antecedentes de pancreatitis', 'Niega pancreatitis'])
  })
})
