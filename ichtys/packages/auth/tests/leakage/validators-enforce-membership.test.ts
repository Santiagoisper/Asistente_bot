import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Leakage suite — alcance por estudio (docs/decisions/study-membership.md, paso 3).
 *
 * Tripwire estático: todo validador exportado de `packages/auth` que devuelve
 * acceso a un estudio o a algo que cuelga de un estudio tiene que comprobar la
 * membresía, directamente o delegando en otro validador que lo hace.
 *
 * Qué cubre y qué no (revisión de #113):
 * - Escanea TODOS los archivos de `packages/auth`, no una lista fija: un
 *   validador nuevo en un archivo nuevo también cae acá.
 * - Quita los comentarios antes de mirar: nombrar otro validador en un
 *   comentario no cuenta como delegar.
 * - Ningún `return` de valor puede aparecer antes de la comprobación.
 * - No compara el mensaje del rechazo con el de «no existe». Eso lo hace la
 *   prueba de comportamiento, validador por validador
 *   (__tests__/access-enforced.test.ts), y por eso la lista de nombres de abajo
 *   es explícita: agregar un validador obliga a pasar por las dos pruebas.
 */
const AUTH_ROOT = join(__dirname, '..', '..')
const FILES = readdirSync(AUTH_ROOT).filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))

interface Validator {
  file: string
  name: string
  body: string
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

function validatorsIn(file: string): Validator[] {
  const source = stripComments(readFileSync(join(AUTH_ROOT, file), 'utf8'))
  return [...source.matchAll(/^export async function (validate\w+)/gm)].map((match) => {
    const rest = source.slice((match.index ?? 0) + match[0].length)
    // El cuerpo llega hasta la siguiente declaración de nivel superior.
    const next = rest.search(/^(export |async function |function |const |interface |type )/m)
    return { file, name: match[1] ?? '', body: next === -1 ? rest : rest.slice(0, next) }
  })
}

const VALIDATORS = FILES.flatMap(validatorsIn)

/** Posición, dentro del cuerpo, de la primera comprobación de membresía (directa o delegada). */
function firstCheck(validator: Validator): number {
  const positions = [validator.body.search(/\bassertStudyMembership\(/)]
  for (const other of VALIDATORS) {
    if (other.name !== validator.name) positions.push(validator.body.search(new RegExp(`\\bawait ${other.name}\\(`)))
  }
  const found = positions.filter((position) => position !== -1)
  return found.length === 0 ? -1 : Math.min(...found)
}

describe('leakage — todo validador comprueba la membresía del estudio', () => {
  it('escanea el paquete entero y encuentra exactamente los validadores conocidos', () => {
    expect(FILES.length).toBeGreaterThan(5)
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
    it(`${validator.file} · ${validator.name}: comprueba la membresía antes de devolver nada`, () => {
      const check = firstCheck(validator)
      expect(check, `${validator.name} no comprueba la membresía`).toBeGreaterThan(-1)
      // Un `return` de valor antes de la comprobación sería un atajo que la saltea.
      const earlyReturn = validator.body.slice(0, check).search(/\breturn\s+[^;\s]/)
      expect(earlyReturn, `${validator.name} devuelve un valor antes de comprobar la membresía`).toBe(-1)
    })
  }

  it('quitar comentarios funciona: un nombre de validador en un comentario no cuenta como delegación', () => {
    const fake = stripComments('// usa validateStudyAccess(\n/* await validateStudyAccess( */\nreturn { ok: true }')
    expect(fake).not.toMatch(/validateStudyAccess\(/)
  })
})
