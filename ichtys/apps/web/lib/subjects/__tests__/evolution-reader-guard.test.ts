/**
 * Guardián: las evoluciones se leen por un solo lugar
 * (docs/decisions/grabacion-en-sujeto-equivocado.md, «Una sola forma de leer evoluciones»).
 *
 * Una evolución puede estar anulada (D24). Que lo esté se sabe por otra tabla, así que cada
 * consulta suelta a `clinical_evolutions` es un lugar donde alguien puede olvidarse de mirarla
 * y tratar como vigente lo que se registró en el sujeto equivocado. Por eso toda lectura pasa
 * por `lib/subjects/evolution-reader.ts`, que obliga a decir si se quieren las anuladas.
 *
 * Este test falla si aparece una lectura de la tabla en cualquier otro archivo de la aplicación,
 * de los scripts de operación o de los paquetes. Escribir (insertar una evolución) no cuenta:
 * no hay nada que saltear al crear.
 *
 * Es un guardián, no un analizador: busca los atajos que alguien toma sin pensar (la consulta
 * del ORM, el SQL a mano, un alias del nombre). El objetivo es que el atajo no pase sin que
 * nadie lo note, no hacerlo imposible. Lo demás lo cubre la revisión.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const MONOREPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')
const READER = ['apps', 'web', 'lib', 'subjects', 'evolution-reader.ts'].join('/')
/** Dónde se busca: la aplicación, los scripts de operación y los paquetes. */
const ROOTS = [['apps', 'web'], ['scripts'], ['packages']].map((parts) => join(MONOREPO_ROOT, ...parts))
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', '__tests__', 'tests', 'coverage', 'public', 'dist', 'migrations'])
/** El esquema define la tabla y sus relaciones: nombrarla ahí no es leerla. */
const SCHEMA_DIR = ['packages', 'db', 'schema'].join('/')

/**
 * Las formas de leer la tabla, o de preparar una lectura que el guardián ya no vería:
 * las tres del ORM (`from`, un `join`, la consulta relacional), el SQL escrito a mano, y
 * darle otro nombre a la tabla (un alias al importarla o una variable intermedia).
 */
const READ_PATTERNS = [
  /\bfrom\(\s*clinicalEvolutions\b/,
  /[jJ]oin\(\s*clinicalEvolutions\b/,
  /\bquery\s*\.\s*clinicalEvolutions\b/,
  /\b(?:from|join)\s+"?clinical_evolutions\b/i,
  /\bclinicalEvolutions\s+as\b/,
  /(?<![=!<>])=\s*clinicalEvolutions\b/,
]

/** Sin comentarios: nombrar la tabla en una explicación no es leerla. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function readsEvolutions(source: string): boolean {
  const code = withoutComments(source)
  return READ_PATTERNS.some((pattern) => pattern.test(code))
}

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full))
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) found.push(full)
  }
  return found
}

function readersOfEvolutions(): string[] {
  return ROOTS.flatMap((root) => sourceFiles(root))
    .map((file) => ({ file, path: relative(MONOREPO_ROOT, file).split(sep).join('/') }))
    .filter(({ path }) => !path.startsWith(`${SCHEMA_DIR}/`))
    .filter(({ file }) => readsEvolutions(readFileSync(file, 'utf8')))
    .map(({ path }) => path)
    .sort()
}

describe('las evoluciones se leen por un solo lugar', () => {
  it('ningún archivo fuera del lector consulta la tabla de evoluciones', () => {
    expect(readersOfEvolutions()).toEqual([READER])
  })

  it('recorre la aplicación, los scripts y los paquetes', () => {
    const scanned = ROOTS.flatMap((root) => sourceFiles(root)).map((file) => relative(MONOREPO_ROOT, file).split(sep).join('/'))
    expect(scanned.some((path) => path.startsWith('apps/web/'))).toBe(true)
    expect(scanned.some((path) => path.startsWith('scripts/'))).toBe(true)
    expect(scanned.some((path) => path.startsWith('packages/'))).toBe(true)
    expect(scanned).toContain(READER)
  })

  it.each([
    ['la consulta del ORM', 'db.select().from(clinicalEvolutions)'],
    ['la consulta del ORM partida en renglones', '.from(\n  clinicalEvolutions,\n)'],
    ['una unión', '.leftJoin(clinicalEvolutions, on)'],
    ['la consulta relacional', 'db.query.clinicalEvolutions.findMany({})'],
    ['SQL a mano', 'await sql`SELECT id FROM clinical_evolutions WHERE subject_id = ${id}`'],
    ['SQL a mano con una unión y comillas', 'db.execute(sql`select 1 from subjects s join "clinical_evolutions" e on e.subject_id = s.id`)'],
    ['un alias al importar', "import { clinicalEvolutions as ce } from '@ichtys/db'"],
    ['una variable intermedia', 'const tabla = clinicalEvolutions'],
  ])('reconoce %s', (_name, sample) => {
    expect(readsEvolutions(sample)).toBe(true)
  })

  it.each([
    ['crear una evolución con el ORM', 'tx.insert(clinicalEvolutions).values({})'],
    ['crear una evolución con SQL', 'INSERT INTO clinical_evolutions (id) VALUES ($1)'],
    ['nombrar la tabla en una lista', "const tables = ['subjects', 'clinical_evolutions', 'patient_profiles']"],
    ['nombrarla en un comentario de bloque', '/** Used by clinical_evolutions.content: select from clinical_evolutions */'],
    ['nombrarla en un comentario de renglón', 'const x = 1 // viene de from(clinicalEvolutions)'],
    ['compararla', 'if (table === clinicalEvolutions) return'],
    ['referirla desde otra tabla', '.references(() => clinicalEvolutions.id)'],
  ])('no confunde con una lectura: %s', (_name, sample) => {
    expect(readsEvolutions(sample)).toBe(false)
  })
})
