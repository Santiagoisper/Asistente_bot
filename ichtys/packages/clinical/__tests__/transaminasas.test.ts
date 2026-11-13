/**
 * Transaminasas contra «N veces el límite superior normal». El límite no es un número fijo:
 * es el que imprime cada laboratorio al lado del valor. Por eso la regla solo decide cuando
 * el perfil guarda el valor Y su rango de referencia; con cualquier duda queda a revisar.
 */
import { describe, expect, it } from 'vitest'
import { studyDictationPrompts } from '../dictation/study-prompts'
import { emptyPatientProfile, type LabObservation, type PatientProfile } from '../profile-schema'
import { assessScreening } from '../screening-engine'
import { upperLimitOfNormal } from '../transaminases'

const CRITERION = 'ALT o AST mayor a 3 veces el limite superior normal.'
const profileWith = (labs: LabObservation[]): PatientProfile => ({ version: 1, labs, medications: [], conditions: [] })
const exclusion = (profile: PatientProfile, text = CRITERION) => assessScreening(profile, { inclusionCriteria: [], exclusionCriteria: [{ number: '3.2', text }] })[0]!
const alt = (value: number, referenceRange?: string): LabObservation => ({ name: 'TGP (ALT)', value, unit: 'U/L', ...(referenceRange ? { referenceRange } : {}) })
const ast = (value: number, referenceRange?: string): LabObservation => ({ name: 'TGO (AST)', value, unit: 'U/L', ...(referenceRange ? { referenceRange } : {}) })

describe('el límite superior sale del rango que imprime el laboratorio', () => {
  it.each([
    ['hasta 40', 40],
    ['Hasta 41 U/L', 41],
    ['10 - 40', 40],
    ['10 a 40 U/L', 40],
    ['0,5 - 1,2', 1.2],
    ['< 41', 41],
    ['≤ 35', 35],
    ['menor a 35', 35],
    ['hasta 40 UI/L', 40],
    ['0 - 35 IU/L', 35],
  ])('%s → %s', (range, expected) => {
    expect(upperLimitOfNormal(range)).toBe(expected)
  })

  // «4.000 - 10.000»: el punto puede ser separador de miles o decimal. No se adivina.
  it.each(['', 'negativo', 'Hombres: hasta 41 · Mujeres: hasta 31', 'hasta 41 (H) / hasta 31 (M)', 'ver informe', '> 60', 'mayor a 10', '10 - 40 …', '4.000 - 10.000', 'hasta 1.000', 'hasta 41 Hombres', 'hasta 31 M', 'hasta 40 Cinetico', '10 - 40 adultos', 'hasta 40 mg/dL'])(
    'si no es un solo límite claro, no se adivina: «%s»',
    (range) => {
      expect(upperLimitOfNormal(range)).toBeNull()
    },
  )
})

describe('elegibilidad: transaminasas', () => {
  it('las dos dentro de tres veces su límite: no activa la exclusión, y el motivo muestra la cuenta', () => {
    const result = exclusion(profileWith([alt(31, 'hasta 41'), ast(24, 'hasta 40')]))
    expect(result.status).toBe('pass')
    expect(result.reason).toContain('ALT 31,0 U/L')
    expect(result.reason).toContain('123,0')
    expect(result.reason).toContain('AST 24,0 U/L')
    expect(result.reason).toContain('120,0')
  })

  it('una sola por encima alcanza para activarla', () => {
    const result = exclusion(profileWith([alt(31, 'hasta 41'), ast(130, 'hasta 40')]))
    expect(result.status).toBe('fail')
    expect(result.reason).toContain('AST 130,0 U/L')
  })

  it('«mayor a» no incluye el límite; «mayor o igual a» sí', () => {
    const atLimit = profileWith([alt(31, 'hasta 41'), ast(120, 'hasta 40')])
    expect(exclusion(atLimit).status).toBe('pass')
    expect(exclusion(atLimit, 'ALT o AST mayor o igual a 3 veces el limite superior normal.').status).toBe('fail')
  })

  it('con una sola de las dos no se despeja: falta la otra', () => {
    const result = exclusion(profileWith([alt(31, 'hasta 41')]))
    expect(result.status).toBe('unknown')
    expect(result.reason).toMatch(/AST/)
    expect(result.missing).toEqual(['transaminases'])
  })

  it('pero una sola por encima sí la activa, aunque falte la otra', () => {
    expect(exclusion(profileWith([ast(130, 'hasta 40')])).status).toBe('fail')
  })

  it('con el valor pero sin el rango del laboratorio no se puede calcular el límite', () => {
    const result = exclusion(profileWith([alt(31), ast(24)]))
    expect(result.status).toBe('unknown')
    expect(result.reason).toMatch(/rango de referencia/)
  })

  it('con un rango que no es un solo límite claro, tampoco', () => {
    const result = exclusion(profileWith([alt(31, 'Hombres: hasta 41 · Mujeres: hasta 31'), ast(24, 'hasta 40')]))
    expect(result.status).toBe('unknown')
    expect(result.reason).toMatch(/rango de referencia/)
  })

  it('con el perfil vacío queda a revisar y dice qué falta', () => {
    const result = exclusion(emptyPatientProfile())
    expect(result.status).toBe('unknown')
    expect(result.reason).toMatch(/ALT/)
    expect(result.reason).toMatch(/AST/)
    expect(result.missing).toEqual(['transaminases'])
  })

  it('si el criterio pide una sola, alcanza con esa', () => {
    expect(exclusion(profileWith([alt(31, 'hasta 41')]), 'ALT mayor a 2,5 veces el limite superior normal.').status).toBe('pass')
    expect(exclusion(profileWith([alt(110, 'hasta 41')]), 'ALT mayor a 2,5 veces el limite superior normal.').status).toBe('fail')
  })

  it('«transaminasas» pide las dos', () => {
    expect(exclusion(profileWith([alt(31, 'hasta 41')]), 'Transaminasas mayores a 3 veces el limite superior normal.').status).toBe('unknown')
    expect(exclusion(profileWith([alt(31, 'hasta 41'), ast(24, 'hasta 40')]), 'Transaminasas mayores a 3 veces el limite superior normal.').status).toBe('pass')
  })

  describe('«y» no es «o»: cuándo alcanza con una sola enzima por encima', () => {
    const oneHigh = profileWith([alt(31, 'hasta 41'), ast(130, 'hasta 40')])
    const bothHigh = profileWith([alt(200, 'hasta 41'), ast(130, 'hasta 40')])
    const normal = profileWith([alt(31, 'hasta 41'), ast(24, 'hasta 40')])

    it.each(['ALT o AST mayor a 3 veces el limite superior normal.', 'ALT y/o AST mayor a 3 veces el limite superior normal.', 'ALT u AST mayor a 3 veces el limite superior normal.', 'ALT or AST > 3 x ULN.', 'ALT and/or AST > 3 x ULN.', 'ALT/AST > 3 x ULN.'])(
      'con «o» una sola la activa: %s',
      (text) => {
        expect(exclusion(oneHigh, text).status).toBe('fail')
        expect(exclusion(normal, text).status).toBe('pass')
      },
    )

    it.each(['ALT y AST mayores a 3 veces el limite superior normal.', 'ALT and AST > 3 x ULN.', 'ALT, AST mayores a 3 veces el limite superior normal.', 'Transaminasas mayores a 3 veces el limite superior normal.'])(
      'sin un «o» expreso, una sola por encima no la activa ni la despeja: %s',
      (text) => {
        const mixed = exclusion(oneHigh, text)
        expect(mixed.status).toBe('unknown')
        expect(mixed.reason).toContain('AST 130,0 U/L supera')
        expect(mixed.reason).toContain('ALT 31,0 U/L no supera')
        expect(mixed.reason).toContain('no dice si alcanza con una sola')
        expect(mixed.missing).toBeUndefined()
        expect(exclusion(bothHigh, text).status).toBe('fail')
        expect(exclusion(normal, text).status).toBe('pass')
      },
    )

    it('sin un «o» expreso, una por encima y la otra sin cargar queda a revisar', () => {
      const result = exclusion(profileWith([ast(130, 'hasta 40')]), 'ALT y AST mayores a 3 veces el limite superior normal.')
      expect(result.status).toBe('unknown')
      expect(result.reason).toContain('Falta ALT')
    })
  })

  describe('más de un número en el criterio: no se aplica el primer múltiplo a todo', () => {
    // Hallazgo de la revisión: «ALT > 5 veces o AST > 3 veces» aplicaba 5 a las dos y despejaba.
    it('falso verde: múltiplos distintos por enzima no despejan con el primero', () => {
      const result = exclusion(
        profileWith([alt(200, 'hasta 41'), ast(160, 'hasta 40')]),
        'ALT mayor a 5 veces el limite superior normal, o AST mayor a 3 veces el limite superior normal.',
      )
      expect(result.status).toBe('unknown')
      expect(result.reason).toContain('más de un número')
      expect(result.missing).toBeUndefined()
    })

    it('falso rojo: tampoco activan con el primero', () => {
      const result = exclusion(
        profileWith([alt(31, 'hasta 41'), ast(160, 'hasta 40')]),
        'ALT mayor a 3 veces el limite superior normal, o AST mayor a 5 veces el limite superior normal.',
      )
      expect(result.status).toBe('unknown')
      expect(result.reason).toContain('más de un número')
    })

    it.each([
      'ALT o AST mayor a 3 veces el limite superior normal o mayor a 200.',
      'ALT > 3 x ULN or AST > 5 x ULN.',
      'ALT mayor a 3 veces o AST mayor a 3 veces el limite superior normal.',
      'ALT o AST mayor a 3 veces el limite superior normal x 2.',
    ])('con cualquier segundo número queda a revisar, con los valores a la vista: %s', (text) => {
      const normal = exclusion(profileWith([alt(31, 'hasta 41'), ast(24, 'hasta 40')]), text)
      expect(normal.status).toBe('unknown')
      const high = exclusion(profileWith([alt(500, 'hasta 41'), ast(500, 'hasta 40')]), text)
      expect(high.status).toBe('unknown')
      expect(high.reason).toContain('más de un número')
    })

    it('un solo múltiplo con decimales sigue siendo un solo número', () => {
      expect(exclusion(profileWith([alt(31, 'hasta 41'), ast(24, 'hasta 40')]), 'ALT o AST mayor a 2,5 veces el limite superior normal.').status).toBe('pass')
      expect(exclusion(profileWith([alt(31, 'hasta 41'), ast(24, 'hasta 40')]), 'ALT o AST mayor a 2.5 veces el limite superior normal.').status).toBe('pass')
    })
  })

  it('lee el criterio en inglés', () => {
    const normal = profileWith([alt(31, 'hasta 41'), ast(24, 'hasta 40')])
    expect(exclusion(normal, 'ALT or AST > 3 x ULN.').status).toBe('pass')
    expect(exclusion(normal, 'ALT or AST greater than 3 times the upper limit of normal.').status).toBe('pass')
    expect(exclusion(profileWith([alt(200, 'hasta 41'), ast(24, 'hasta 40')]), 'ALT or AST > 3 x ULN.').status).toBe('fail')
  })

  it.each([
    'ALT o AST mayor a 3 veces el limite superior normal, o bilirrubina total mayor a 2 veces.',
    'ALT o AST mayor a 3 veces el limite superior normal con sintomas de hepatitis.',
    'ALT o AST mayor a 3 veces el limite superior normal en dos determinaciones.',
  ])('si el criterio pide algo más, no lo despeja ni lo activa solo: %s', (text) => {
    expect(exclusion(profileWith([alt(31, 'hasta 41'), ast(24, 'hasta 40')]), text).status).toBe('unknown')
    const high = exclusion(profileWith([alt(31, 'hasta 41'), ast(130, 'hasta 40')]), text)
    expect(high.status).toBe('unknown')
    expect(high.reason).toContain('AST 130,0 U/L')
  })

  it('sin un «N veces el límite» en el criterio, la regla no opina', () => {
    expect(exclusion(profileWith([alt(31, 'hasta 41'), ast(24, 'hasta 40')]), 'ALT elevada.').reason).toMatch(/revisión manual/)
  })

  it('no confunde otros análisis con una transaminasa', () => {
    const result = exclusion(profileWith([{ name: 'Fosfatasa alcalina', value: 500, unit: 'U/L', referenceRange: 'hasta 120' }, { name: 'Glucosa en ayunas', value: 128, unit: 'mg/dL', referenceRange: '70 - 110' }]))
    expect(result.status).toBe('unknown')
  })

  it('un cociente AST/ALT no es ni una ni la otra', () => {
    const ratio: LabObservation = { name: 'Relación AST/ALT', value: 1.2, referenceRange: 'hasta 2' }
    const alone = exclusion(profileWith([ratio]))
    expect(alone.status).toBe('unknown')
    expect(alone.reason).toContain('Falta ALT y AST')
    const withBoth = exclusion(profileWith([ratio, alt(31, 'hasta 41'), ast(130, 'hasta 40')]))
    expect(withBoth.status).toBe('fail')
    expect(withBoth.reason).toContain('AST 130,0 U/L')
    expect(withBoth.reason).not.toContain('1,2')
  })

  it('con dos valores distintos de la misma enzima no elige uno: queda a revisar y lo dice', () => {
    const result = exclusion(profileWith([alt(31, 'hasta 41'), { name: 'ALT', value: 200, unit: 'U/L', referenceRange: 'hasta 41' }, ast(24, 'hasta 40')]))
    expect(result.status).toBe('unknown')
    expect(result.reason).toContain('más de un valor de ALT')
    expect(result.missing).toBeUndefined()
  })

  it('si la unidad del valor no es de actividad enzimática, no compara', () => {
    const result = exclusion(profileWith([{ name: 'ALT', value: 31, unit: 'mg/dL', referenceRange: 'hasta 41' }, ast(24, 'hasta 40')]))
    expect(result.status).toBe('unknown')
  })
})

describe('la guía del estudio', () => {
  it('las transaminasas no se dictan: se resuelven con el laboratorio', () => {
    const prompts = studyDictationPrompts([exclusion(emptyPatientProfile())])
    expect(prompts.map((prompt) => prompt.id)).toEqual(['transaminases'])
    expect(prompts[0]!.say).toEqual([])
    expect(prompts[0]!.note).toMatch(/laboratorio/)
  })
})
