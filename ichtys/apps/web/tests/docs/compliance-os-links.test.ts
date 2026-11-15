import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { describe, expect, it } from 'vitest'

// El índice de cumplimiento y los requisitos del OS responden «¿dónde está la evidencia?» con un enlace.
// Un enlace roto es una respuesta falsa: esta prueba comprueba que cada documento o prueba citados existen.
const ROOT = join(__dirname, '../../../..')
const DOCS = ['docs/compliance/COMPLIANCE-INDEX-OS.md', 'docs/compliance/URS-OS.md']

function cited(path: string): string[] {
  const text = readFileSync(join(ROOT, path), 'utf8')
  const links = [...text.matchAll(/\]\((\.{1,2}\/[^)#]+)/g)].map((match) => normalize(join(dirname(path), match[1]!)))
  const files = [...text.matchAll(/`((?:apps|packages)\/[^`]+\.test\.tsx?)`/g)].map((match) => match[1]!)
  return [...new Set([...links, ...files])]
}

describe.each(DOCS)('%s — lo que cita existe', (doc) => {
  const paths = cited(doc)

  it('cita documentos', () => {
    expect(paths.length).toBeGreaterThan(5)
  })

  it.each(paths)('%s', (path) => {
    expect(existsSync(join(ROOT, path))).toBe(true)
  })
})

describe('requisitos del OS', () => {
  const text = readFileSync(join(ROOT, 'docs/compliance/URS-OS.md'), 'utf8')
  const rows = text.split('\n').filter((line) => /^\| OS-\d+ \|/.test(line))

  it('cada requisito dice de dónde sale: decisión, regla o propuesta', () => {
    expect(rows.length).toBeGreaterThan(15)
    for (const row of rows) expect(row.split('|')[3], row).toMatch(/Decisión|Regla|Propuesta|Diseño/)
  })

  it('se presenta como borrador sin aprobar', () => {
    expect(text).toMatch(/BORRADOR\. Nadie aprobó estos requisitos/)
  })
})
