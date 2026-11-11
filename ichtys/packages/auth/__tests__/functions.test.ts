import { describe, expect, it } from 'vitest'
import type { MemberFunction } from '@ichtys/db'
import {
  CAPABILITIES,
  FULL_SCOPE_FUNCTIONS,
  FUNCTION_CAPABILITIES,
  allows,
  capabilitiesOf,
  hasFullStudyScope,
  parseAccessMode,
  parseMemberFunctions,
  suggestedFunctionsForLegacyRole,
  type AccessSubject,
} from '../functions'
import { ROLES, type Role } from '../roles'

const ALL_FUNCTIONS = Object.keys(FUNCTION_CAPABILITIES) as MemberFunction[]
const NON_MEDICAL = ALL_FUNCTIONS.filter((fn) => fn !== 'investigator')

/** Todos los subconjuntos de una lista (2^n). */
function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((acc, item) => acc.concat(acc.map((subset) => [...subset, item])), [[]])
}

function enforced(functions: readonly MemberFunction[], role: Role = ROLES.ORG_ADMIN): AccessSubject {
  return { mode: 'enforced', role, functions }
}

const never = () => false
const always = () => true

describe('matriz de funciones', () => {
  it('cada función tiene capacidades y todas existen en la lista', () => {
    for (const fn of ALL_FUNCTIONS) {
      expect(FUNCTION_CAPABILITIES[fn].length, fn).toBeGreaterThan(0)
      for (const capability of FUNCTION_CAPABILITIES[fn]) expect(CAPABILITIES).toContain(capability)
    }
  })

  it('las capacidades de varias funciones son la suma', () => {
    const combined = capabilitiesOf(['lab_assistant', 'regulatory_assistant', 'crf_assistant'])
    expect(combined.has('labs.manage')).toBe(true)
    expect(combined.has('documents.manage')).toBe(true)
    expect(combined.has('crf.manage')).toBe(true)
    expect(combined.has('clinical.author')).toBe(false)
  })

  it('sin funciones no hay ninguna capacidad', () => {
    expect(capabilitiesOf([]).size).toBe(0)
  })
})

describe('composición: quien contiene a otra función no pierde nada de ella', () => {
  function contains(outer: MemberFunction, inner: MemberFunction): string[] {
    const outerCapabilities = capabilitiesOf([outer])
    return [...capabilitiesOf([inner])].filter((capability) => !outerCapabilities.has(capability))
  }

  it('Dirección de Operaciones contiene todo lo del Study Coordinator', () => {
    expect(contains('operations_director', 'study_coordinator')).toEqual([])
  })

  it('el Study Coordinator contiene todo lo de cada asistente', () => {
    for (const assistant of ['lab_assistant', 'regulatory_assistant', 'crf_assistant'] as const) {
      expect(contains('study_coordinator', assistant), assistant).toEqual([])
    }
  })

  it('Dirección de Investigación solo lee', () => {
    for (const capability of capabilitiesOf(['research_director'])) {
      expect(capability.endsWith('.read'), capability).toBe(true)
    }
  })
})

describe('cada capacidad nombra el par dato.operación', () => {
  it('todas tienen la forma dato.operación', () => {
    for (const capability of CAPABILITIES) expect(capability).toMatch(/^[a-z]+\.[a-z_]+$/)
  })

  it('leer el estudio y leer datos clínicos son capacidades distintas', () => {
    expect(capabilitiesOf(['monitor']).has('study.read')).toBe(true)
    expect(capabilitiesOf(['monitor']).has('clinical.read')).toBe(false)
  })

  it('el asistente de CRF ve los datos que van al CRF', () => {
    const capabilities = capabilitiesOf(['crf_assistant'])
    expect(capabilities.has('clinical.read')).toBe(true)
    expect(capabilities.has('crf.manage')).toBe(true)
  })
})

describe('parseMemberFunctions: un nombre desconocido restringe y queda a la vista', () => {
  it('separa las funciones conocidas de las que no', () => {
    expect(parseMemberFunctions(['investigator', 'investigador', 'monitor'])).toEqual({
      known: ['investigator', 'monitor'],
      unknown: ['investigador'],
    })
  })

  it('un nombre desconocido no da ninguna capacidad', () => {
    const { known } = parseMemberFunctions(['Investigator', ' investigator', 'admin'])
    expect(known).toEqual([])
    expect(capabilitiesOf(known).size).toBe(0)
  })

  it('no confunde propiedades heredadas de un objeto con funciones', () => {
    expect(parseMemberFunctions(['toString', 'constructor', '__proto__', 'hasOwnProperty']).known).toEqual([])
  })

  it('no duplica', () => {
    expect(parseMemberFunctions(['monitor', 'monitor']).known).toEqual(['monitor'])
  })
})

describe('autoría clínica: solo el médico evoluciona y responde queries', () => {
  it('la capacidad figura únicamente en la función investigator', () => {
    const withAuthorship = ALL_FUNCTIONS.filter((fn) => FUNCTION_CAPABILITIES[fn].includes('clinical.author'))
    expect(withAuthorship).toEqual(['investigator'])
  })

  it('ninguna combinación de las demás funciones la alcanza (256 combinaciones)', () => {
    const combinations = subsets(NON_MEDICAL)
    expect(combinations).toHaveLength(2 ** NON_MEDICAL.length)
    for (const functions of combinations) {
      // El rol histórico más alto no la da: en modo estricto el rol no cuenta.
      expect(allows(enforced(functions, ROLES.ORG_ADMIN), 'clinical.author', always), functions.join('+')).toBe(false)
    }
  })

  it('investigator la da, sola o acumulada con cualquier otra', () => {
    for (const others of subsets(NON_MEDICAL)) {
      const functions: MemberFunction[] = ['investigator', ...others]
      expect(allows(enforced(functions, ROLES.READ_ONLY_MONITOR), 'clinical.author', never), functions.join('+')).toBe(
        true,
      )
    }
  })

  it('quien dirige investigación no evoluciona por dirigir, pero sí si además es médico', () => {
    expect(capabilitiesOf(['research_director']).has('clinical.author')).toBe(false)
    expect(capabilitiesOf(['research_director', 'investigator']).has('clinical.author')).toBe(true)
  })
})

describe('administración de la plataforma (M12)', () => {
  it('sola no ve datos clínicos ni entra a estudios', () => {
    const capabilities = capabilitiesOf(['platform_admin'])
    expect(capabilities.has('clinical.read')).toBe(false)
    expect(capabilities.has('study.read')).toBe(false)
    expect(hasFullStudyScope(['platform_admin'])).toBe(false)
  })

  it('administra ajustes y equipo', () => {
    const capabilities = capabilitiesOf(['platform_admin'])
    expect(capabilities.has('org.settings')).toBe(true)
    expect(capabilities.has('access.manage_org')).toBe(true)
  })
})

describe('alcance', () => {
  it('solo las direcciones entran a todos los estudios', () => {
    expect([...FULL_SCOPE_FUNCTIONS].sort()).toEqual(['operations_director', 'research_director'])
    for (const fn of ALL_FUNCTIONS) {
      expect(hasFullStudyScope([fn]), fn).toBe(FULL_SCOPE_FUNCTIONS.includes(fn))
    }
  })

  it('el Study Coordinator no entra a todo (M3)', () => {
    expect(hasFullStudyScope(['study_coordinator'])).toBe(false)
  })
})

describe('monitor', () => {
  it('lee el estudio y nada más', () => {
    expect([...capabilitiesOf(['monitor'])]).toEqual(['study.read'])
  })
})

describe('equipo del estudio', () => {
  it('cada asistente tiene su tarea y no la de los otros', () => {
    expect(capabilitiesOf(['lab_assistant']).has('labs.manage')).toBe(true)
    expect(capabilitiesOf(['lab_assistant']).has('documents.manage')).toBe(false)
    expect(capabilitiesOf(['regulatory_assistant']).has('documents.manage')).toBe(true)
    expect(capabilitiesOf(['regulatory_assistant']).has('crf.manage')).toBe(false)
    expect(capabilitiesOf(['crf_assistant']).has('crf.manage')).toBe(true)
    expect(capabilitiesOf(['crf_assistant']).has('labs.manage')).toBe(false)
  })

  it('el investigador no gestiona documentos ni da accesos', () => {
    const capabilities = capabilitiesOf(['investigator'])
    expect(capabilities.has('documents.manage')).toBe(false)
    expect(capabilities.has('access.manage_study')).toBe(false)
    expect(capabilities.has('org.settings')).toBe(false)
  })

  it('el Study Coordinator da acceso en sus estudios pero no administra la organización (M11)', () => {
    const capabilities = capabilitiesOf(['study_coordinator'])
    expect(capabilities.has('access.manage_study')).toBe(true)
    expect(capabilities.has('access.manage_org')).toBe(false)
  })
})

describe('allows: el modo decide quién manda', () => {
  it('en open decide la comprobación histórica y las funciones no cuentan', () => {
    const noFunctions: AccessSubject = { mode: 'open', role: ROLES.SITE_COORDINATOR, functions: [] }
    expect(allows(noFunctions, 'clinical.author', always)).toBe(true)

    const medic: AccessSubject = { mode: 'open', role: ROLES.READ_ONLY_MONITOR, functions: ['investigator'] }
    expect(allows(medic, 'clinical.author', never)).toBe(false)
  })

  it('en open la comprobación histórica recibe el rol de la persona', () => {
    const seen: Role[] = []
    allows({ mode: 'open', role: ROLES.STUDY_ADMIN, functions: [] }, 'study.create', (role) => {
      seen.push(role)
      return true
    })
    expect(seen).toEqual([ROLES.STUDY_ADMIN])
  })

  it('en enforced deciden las funciones y la comprobación histórica ni se llama', () => {
    let called = false
    const legacy = () => {
      called = true
      return true
    }
    expect(allows(enforced([]), 'study.read', legacy)).toBe(false)
    expect(allows(enforced(['monitor']), 'study.read', legacy)).toBe(true)
    expect(called).toBe(false)
  })
})

describe('parseAccessMode: ante la duda, se restringe', () => {
  it('solo el valor exacto open abre', () => {
    expect(parseAccessMode('open')).toBe('open')
    expect(parseAccessMode('enforced')).toBe('enforced')
    for (const value of ['OPEN', ' open', '', 'abierto', null, undefined, 0, true, {}]) {
      expect(parseAccessMode(value), String(value)).toBe('enforced')
    }
  })
})

describe('sugerencia inicial desde el rol histórico', () => {
  it('cubre los cinco roles', () => {
    expect(suggestedFunctionsForLegacyRole(ROLES.PRINCIPAL_INVESTIGATOR)).toEqual(['investigator'])
    expect(suggestedFunctionsForLegacyRole(ROLES.SITE_COORDINATOR)).toEqual(['study_coordinator'])
    expect(suggestedFunctionsForLegacyRole(ROLES.STUDY_ADMIN)).toEqual(['study_coordinator'])
    expect(suggestedFunctionsForLegacyRole(ROLES.ORG_ADMIN)).toEqual(['operations_director', 'platform_admin'])
    expect(suggestedFunctionsForLegacyRole(ROLES.READ_ONLY_MONITOR)).toEqual(['monitor'])
  })

  it('no le sugiere autoría clínica a quien no era investigador', () => {
    for (const role of [ROLES.ORG_ADMIN, ROLES.STUDY_ADMIN, ROLES.SITE_COORDINATOR, ROLES.READ_ONLY_MONITOR]) {
      expect(capabilitiesOf(suggestedFunctionsForLegacyRole(role)).has('clinical.author'), role).toBe(false)
    }
  })
})
