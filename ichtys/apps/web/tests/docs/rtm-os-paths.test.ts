import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * La matriz de trazabilidad del OS cita pruebas por su archivo. Si una prueba se mueve o se
 * borra y la matriz la sigue citando, la matriz afirma una evidencia que ya no existe.
 */
const ROOT = join(__dirname, '../../../..')
const matrix = readFileSync(join(ROOT, 'docs/compliance/RTM-OS.md'), 'utf8')
const cited = [...matrix.matchAll(/`((?:apps|packages)\/[^`]+\.test\.tsx?)`/g)].map((match) => match[1]!)

describe('RTM-OS.md — cada prueba citada existe', () => {
  it('cita pruebas', () => {
    expect(cited.length).toBeGreaterThan(20)
  })

  it.each([...new Set(cited)])('%s', (path) => {
    expect(existsSync(join(ROOT, path))).toBe(true)
  })

  it('una fila sin prueba lo dice con todas las letras, no con una celda vacía', () => {
    const rows = matrix.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Comportamiento') && !line.startsWith('|---'))
    for (const row of rows) {
      const cells = row.split('|').map((cell) => cell.trim())
      const proof = cells[2] ?? ''
      expect(proof === '**Ninguna**' || /\.test\.tsx?`/.test(proof)).toBe(true)
    }
  })
})
