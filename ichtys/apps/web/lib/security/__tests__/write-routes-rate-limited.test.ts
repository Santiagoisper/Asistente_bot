import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guarda (auditoría 19/11, H-04): toda ruta de la API que escribe tiene un límite de pedidos.
 * Una ruta nueva con POST, PUT, PATCH o DELETE y sin límite hace fallar esta prueba; para
 * dejarla afuera hay que sumarla abajo con el motivo.
 */
const EXEMPT: Record<string, string> = {
  // Solo la usan operadores listados, una vez, y tiene fecha de baja (C3).
  'app/api/os/screening-seal/route.ts': 'operadores listados; ruta con fecha de baja',
}

const ROOT = join(__dirname, '..', '..', '..')
const API = join(ROOT, 'app', 'api')

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') return []
    if (statSync(full).isDirectory()) return routes(full)
    return name === 'route.ts' ? [full] : []
  })
}

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('rutas que escriben', () => {
  const writers = routes(API).filter((file) =>
    /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(readFileSync(file, 'utf8')),
  )

  it('hay rutas que escriben (la guarda no corre vacía)', () => {
    expect(writers.length).toBeGreaterThan(20)
  })

  it.each(writers.map((file) => [relative(ROOT, file).replaceAll('\\', '/')]))('%s tiene límite de pedidos', (rel) => {
    if (EXEMPT[rel]) return
    const source = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
    expect(/clinicalRateLimit\(|enforceSlidingWindowRateLimit\(/.test(source)).toBe(true)
  })

  it('las excepciones existen y escriben (no quedan nombres viejos)', () => {
    for (const rel of Object.keys(EXEMPT)) {
      expect(writers.map((f) => relative(ROOT, f).replaceAll('\\', '/'))).toContain(rel)
    }
  })
})
