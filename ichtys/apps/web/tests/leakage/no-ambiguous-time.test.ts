import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * La hora de un registro no se muestra ambigua.
 *
 * En español de Argentina, `toLocaleString` y `toLocaleTimeString` usan 12 horas y hay navegadores
 * que no imprimen «a. m./p. m.»: una evolución de las 17:38 se leía «05:38» (visto el 15/11/2026 en
 * el entorno de prueba). En una página armada en el servidor, además, dan la hora UTC.
 *
 * Regla: una fecha con hora se muestra con `formatDateTime` (lib/os/date-time.ts), o con un formato
 * que fije el ciclo de 24 horas. Los números (`toLocaleString` con opciones de dígitos, o los de
 * la lista de abajo) no tienen hora y quedan afuera.
 */
const WEB = join(__dirname, '..', '..')
const ROOTS = ['app', 'components', 'lib'].map((dir) => join(WEB, dir))

/** Llamadas a `toLocaleString` sobre un número, sin opciones. Archivo y texto exacto de la línea. */
const NUMBERS: ReadonlyArray<[string, string]> = [['components/usage/usage-panel.tsx', "row.tokens.toLocaleString('es-AR')"]]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

function problemsIn(file: string, text: string): string[] {
  const lines = text.split('\n')
  const found: string[] = []
  lines.forEach((line, index) => {
    const where = `${file}:${index + 1}`
    if (/\.toLocaleTimeString\(/.test(line)) found.push(`${where} usa toLocaleTimeString`)
    if (/\.toLocaleString\(/.test(line)) {
      const isNumber = /minimumFractionDigits|maximumFractionDigits/.test(line) || NUMBERS.some(([f, t]) => file === f && line.includes(t))
      if (!isNumber) found.push(`${where} usa toLocaleString sin fijar las 24 horas`)
    }
    if (/\b(timeStyle|hour)\s*:/.test(line)) {
      // El formato se arma en un objeto de pocas líneas: el ciclo tiene que estar ahí mismo.
      const block = lines.slice(Math.max(0, index - 8), index + 9).join('\n')
      if (!/hourCycle\s*:\s*'h23'/.test(block)) found.push(`${where} arma un formato con hora sin hourCycle 'h23'`)
    }
  })
  return found
}

describe('la hora no se muestra ambigua', () => {
  const files = ROOTS.flatMap(sourceFiles)

  it('encuentra los archivos a revisar', () => {
    expect(files.length).toBeGreaterThan(200)
  })

  it('ninguna pantalla formatea una hora sin fijar las 24 horas', () => {
    const problems = files.flatMap((path) => problemsIn(relative(WEB, path), readFileSync(path, 'utf8')))
    expect(problems).toEqual([])
  })

  it('la guarda reconoce los tres casos que busca', () => {
    expect(problemsIn('x.tsx', "{new Date(evo.createdAt).toLocaleString('es-AR')}")).toHaveLength(1)
    expect(problemsIn('x.tsx', 'const t = date.toLocaleTimeString()')).toHaveLength(1)
    expect(problemsIn('x.ts', "new Intl.DateTimeFormat('es-AR', {\n  dateStyle: 'short',\n  timeStyle: 'medium',\n})")).toHaveLength(1)
  })

  it('y deja pasar un formato de 24 horas y un número', () => {
    expect(problemsIn('x.ts', "new Intl.DateTimeFormat('es-AR', {\n  timeStyle: 'medium',\n  hourCycle: 'h23',\n})")).toEqual([])
    expect(problemsIn('x.tsx', "value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })")).toEqual([])
  })
})
