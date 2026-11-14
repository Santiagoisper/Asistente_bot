/**
 * Guardián: las evoluciones se leen por un solo lugar
 * (docs/decisions/grabacion-en-sujeto-equivocado.md, «Una sola forma de leer evoluciones»).
 *
 * Una evolución puede estar anulada (D24). Que lo esté se sabe por otra tabla, así que cada
 * consulta suelta a `clinical_evolutions` es un lugar donde alguien puede olvidarse de mirarla
 * y tratar como vigente lo que se registró en el sujeto equivocado. Por eso toda lectura pasa
 * por `lib/subjects/evolution-reader.ts`, que obliga a decir si se quieren las anuladas.
 *
 * Este test falla si aparece una lectura de la tabla en cualquier otro archivo. Escribir
 * (insertar una evolución) no cuenta: no hay nada que saltear al crear.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = join(__dirname, '..', '..', '..')
const READER = ['lib', 'subjects', 'evolution-reader.ts'].join('/')
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__', 'coverage', 'public'])

/** Las tres formas de leer una tabla con este ORM: `from`, un `join` y la consulta relacional. */
const READ_PATTERNS = [/\bfrom\(\s*clinicalEvolutions\b/, /[jJ]oin\(\s*clinicalEvolutions\b/, /\bquery\s*\.\s*clinicalEvolutions\b/]

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) found.push(full)
  }
  return found
}

function readersOfEvolutions(): string[] {
  return sourceFiles(WEB_ROOT)
    .filter((file) => READ_PATTERNS.some((pattern) => pattern.test(readFileSync(file, 'utf8'))))
    .map((file) => relative(WEB_ROOT, file).split(sep).join('/'))
    .sort()
}

describe('las evoluciones se leen por un solo lugar', () => {
  it('ningún archivo fuera del lector consulta la tabla de evoluciones', () => {
    expect(readersOfEvolutions()).toEqual([READER])
  })

  it('el guardián reconoce las tres formas de leer', () => {
    const samples = ['db.select().from(clinicalEvolutions)', '.leftJoin(clinicalEvolutions, on)', 'db.query.clinicalEvolutions.findMany({})', '.from(\n  clinicalEvolutions,\n)']
    for (const sample of samples) expect(READ_PATTERNS.some((pattern) => pattern.test(sample)), sample).toBe(true)
    // Crear una evolución no es leerla.
    expect(READ_PATTERNS.some((pattern) => pattern.test('tx.insert(clinicalEvolutions).values({})'))).toBe(false)
  })
})
