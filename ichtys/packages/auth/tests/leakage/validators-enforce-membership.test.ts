import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Leakage suite — alcance por estudio (docs/decisions/study-membership.md, paso 3).
 *
 * Tripwire estático: todo validador exportado de `packages/auth` que devuelve
 * acceso a un estudio o a algo que cuelga de un estudio tiene que comprobar la
 * membresía, directamente o delegando en otro validador que lo hace. Si alguien
 * agrega un validador nuevo y se olvida, este test rompe.
 *
 * No prueba el comportamiento (eso está en __tests__/access-enforced.test.ts);
 * prueba que ningún validador quede afuera.
 */
const AUTH_ROOT = join(__dirname, '..', '..')
const FILES = ['validate-study-access.ts', 'phi-access.ts', 'object-access.ts'] as const

interface Validator {
  file: string
  name: string
  body: string
}

function validatorsIn(file: string): Validator[] {
  const source = readFileSync(join(AUTH_ROOT, file), 'utf8')
  const starts = [...source.matchAll(/^export async function (validate\w+)/gm)]
  return starts.map((match) => {
    const from = match.index ?? 0
    // El cuerpo llega hasta la siguiente declaración de nivel superior.
    const rest = source.slice(from + match[0].length)
    const next = rest.search(/^(export |async function |function |const |interface |type )/m)
    const body = next === -1 ? rest : rest.slice(0, next)
    return { file, name: match[1] ?? '', body }
  })
}

const VALIDATORS = FILES.flatMap(validatorsIn)

describe('leakage — todo validador comprueba la membresía del estudio', () => {
  it('encuentra los validadores conocidos (si el patrón deja de coincidir, el test no pasa en vacío)', () => {
    expect(VALIDATORS.map((v) => v.name).sort()).toEqual(
      [
        'validateConversationAccess',
        'validateDocumentAccess',
        'validateDocumentPageAccess',
        'validateDocumentVersionAccess',
        'validateMessageAccess',
        'validatePhiStudyAccess',
        'validateStudyAccess',
        'validateSubjectAccess',
      ].sort(),
    )
  })

  for (const validator of VALIDATORS) {
    it(`${validator.file} · ${validator.name}`, () => {
      const checksDirectly = /\bassertStudyMembership\(/.test(validator.body)
      const delegates = VALIDATORS.some(
        (other) => other.name !== validator.name && new RegExp(`\\b${other.name}\\(`).test(validator.body),
      )
      expect(checksDirectly || delegates, `${validator.name} no comprueba la membresía`).toBe(true)
    })
  }

  it('la comprobación va antes de devolver el contexto, no después', () => {
    for (const validator of VALIDATORS) {
      const check = validator.body.search(/\bassertStudyMembership\(/)
      if (check === -1) continue
      const lastReturn = validator.body.lastIndexOf('\n  return ')
      expect(lastReturn, validator.name).toBeGreaterThan(check)
    }
  })
})
