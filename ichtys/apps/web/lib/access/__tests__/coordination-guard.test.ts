/**
 * Guardián: «quien coordina el estudio» se decide con `coordinatesStudy`
 * (docs/decisions/grabacion-en-sujeto-equivocado.md, punto 1; pedido de Architect en el #183).
 *
 * Pedirle la capacidad `access.manage_study` al validador clínico (`require`) parece hacer lo
 * mismo y no lo hace: en modo `open`, que es el que está en uso, ahí una capacidad adicional
 * no restringe a nadie. Así fue como «autor o coordinación» terminó siendo «cualquiera con
 * acceso clínico» sin que ninguna prueba lo notara (#173, hallado en el #180).
 *
 * Este test falla si ese atajo vuelve a aparecer en la aplicación. Es un guardián, no un
 * analizador: busca la forma que alguien escribe sin pensar.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = join(__dirname, '..', '..', '..')
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', '__tests__', 'tests', 'coverage', 'public', 'dist'])
const SHORTCUT = /require\s*:\s*['"`]access\.manage_study['"`]/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('guardián — la coordinación no se pide con require en el validador clínico', () => {
  it('ningún archivo de la aplicación usa require: access.manage_study; se usa coordinatesStudy', () => {
    const files = sourceFiles(WEB_ROOT)
    // Si la búsqueda no recorre nada, el guardián no está mirando.
    expect(files.length).toBeGreaterThan(200)
    const offenders = files.filter((file) => SHORTCUT.test(readFileSync(file, 'utf8'))).map((file) => relative(WEB_ROOT, file).split(sep).join('/'))
    expect(offenders, 'En modo open eso no restringe a nadie: usá coordinatesStudy (lib/access/permissions.ts).').toEqual([])
  })

  it('el patrón reconoce el atajo, con comillas simples, dobles o espacios', () => {
    expect(SHORTCUT.test("validateSubjectAccess(id, study, { require: 'access.manage_study' })")).toBe(true)
    expect(SHORTCUT.test('{ require : "access.manage_study" }')).toBe(true)
    expect(SHORTCUT.test("{ require: 'clinical.author' }")).toBe(false)
  })
})
