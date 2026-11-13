/**
 * Guardián de colores (12/11/2026). Un botón se escribió con `bg-alphi-ink`, un color
 * que no existe en la paleta: Tailwind no generó nada, el botón quedó sin fondo y su
 * ícono blanco no se veía. Las pruebas de componentes pasaban porque miran el HTML, no
 * los colores. Esta prueba recorre el código y falla si aparece una clase de color
 * `alphi-*` u `os-*` que la configuración no define.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../../tailwind.config'

const ROOT = join(__dirname, '..', '..')
const UTILITIES = ['bg', 'text', 'border', 'ring', 'outline', 'fill', 'stroke', 'from', 'to', 'via', 'divide', 'placeholder', 'decoration', 'accent', 'caret']

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.') || name === '__tests__') return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(tsx|ts|css)$/.test(name) ? [path] : []
  })
}

describe('colores del sistema de diseño', () => {
  const colors = (config.theme?.extend?.colors ?? {}) as Record<string, Record<string, string>>
  const known = new Set(Object.entries(colors).flatMap(([family, shades]) => Object.keys(shades).map((shade) => `${family}-${shade}`)))
  const pattern = new RegExp(`(?:^|[\\s"'\`:])(?:${UTILITIES.join('|')})-((?:alphi|os)-[a-z]+)`, 'g')

  it('la paleta se pudo leer', () => {
    expect(known.has('alphi-navy')).toBe(true)
    expect(known.has('os-ink')).toBe(true)
  })

  it('ninguna clase usa un color que la paleta no define', () => {
    const unknown: string[] = []
    for (const file of [...files(join(ROOT, 'components')), ...files(join(ROOT, 'app'))]) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(pattern)) {
        if (!known.has(match[1]!)) unknown.push(`${file.replace(ROOT, '')}: ${match[0].trim()}`)
      }
    }
    expect(unknown).toEqual([])
  })
})
