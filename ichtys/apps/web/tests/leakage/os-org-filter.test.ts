import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Leakage suite — datos del Clinical Research OS.
 *
 * Tripwire estático, en la línea de api-auth-coverage: en los archivos de datos
 * del OS, cada tabla que entra a una consulta (`.from(` o `.innerJoin(`) tiene
 * que venir con su filtro de organización. Si alguien agrega una consulta o un
 * join sin `organizationId, orgId`, este test rompe.
 */
const WEB_ROOT = join(__dirname, '..', '..')
const FILES = ['lib/os/inicio-data.ts', 'lib/os/search.ts'] as const

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0
}

describe('leakage — consultas del OS filtradas por organización', () => {
  for (const file of FILES) {
    const source = readFileSync(join(WEB_ROOT, file), 'utf8')

    it(`${file}: cada tabla consultada lleva su filtro de organización`, () => {
      const tables = countMatches(source, /\.from\(/g) + countMatches(source, /\.innerJoin\(/g)
      const filters = countMatches(source, /\.organizationId, orgId\)/g)
      expect(tables).toBeGreaterThan(0)
      expect(filters).toBeGreaterThanOrEqual(tables)
    })

    it(`${file}: no usa joins sin condición ni SQL crudo sobre tablas completas`, () => {
      expect(source).not.toMatch(/\.leftJoin\(|\.fullJoin\(|\.rightJoin\(|\.crossJoin\(/)
      expect(source).not.toMatch(/db\.execute\(/)
    })

    it(`${file}: no descifra PHI`, () => {
      expect(source).not.toMatch(/decrypt|profileEncrypted|profile_encrypted/)
    })
  }

  it.each(['lib/labs/lab-report-service.ts', 'lib/labs/lab-image-report.ts'])('%s: toda consulta y toda escritura llevan la organización', (file) => {
    const source = readFileSync(join(WEB_ROOT, file), 'utf8')
    const wheres = countMatches(source, /\.where\(/g)
    const filters = countMatches(source, /\.organizationId, (params\.)?orgId\)/g)
    expect(wheres).toBeGreaterThan(0)
    expect(filters).toBeGreaterThanOrEqual(wheres)
    const inserts = countMatches(source, /\.insert\(/g)
    expect(countMatches(source, /organizationId: params\.orgId/g)).toBeGreaterThanOrEqual(inserts)
  })

  it('las rutas de informes validan el sujeto contra el estudio de la URL', () => {
    const base = 'app/api/studies/[id]/subjects/[subjectId]/lab-reports'
    for (const file of ['route.ts', 'images/route.ts', '[reportId]/route.ts', '[reportId]/image/[page]/route.ts', '[reportId]/confirm/route.ts', '[reportId]/reject/route.ts']) {
      const route = readFileSync(join(WEB_ROOT, base, file), 'utf8')
      expect(route).toContain('validateSubjectAccess(subjectId, studyId)')
      expect(route).not.toMatch(/orgId: (body|parsed\.data)/)
    }
  })

  it('la ruta del buscador toma la organización del token de Clerk', () => {
    const route = readFileSync(join(WEB_ROOT, 'app/api/search/route.ts'), 'utf8')
    expect(route).toContain('await auth()')
    expect(route).not.toMatch(/searchParams\.get\(['"](orgId|organizationId|organization_id)['"]\)/)
  })
})
