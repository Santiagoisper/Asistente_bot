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

  it.each(['lib/labs/lab-report-service.ts', 'lib/labs/lab-image-report.ts', 'lib/agenda/agenda-service.ts', 'lib/os/org-integrations.ts'])('%s: toda consulta y toda escritura llevan la organización', (file) => {
    const source = readFileSync(join(WEB_ROOT, file), 'utf8')
    const wheres = countMatches(source, /\.where\(/g)
    const filters = countMatches(source, /\.organizationId, (params\.)?orgId\)/g)
    expect(wheres).toBeGreaterThan(0)
    expect(filters).toBeGreaterThanOrEqual(wheres)
    const inserts = countMatches(source, /\.insert\(/g)
    expect(countMatches(source, /organizationId: params\.orgId/g)).toBeGreaterThanOrEqual(inserts)
  })

  it.each(['lib/labs/lab-report-service.ts', 'lib/labs/lab-image-report.ts'])('%s: quien busca un informe por id lo ata también al estudio y al sujeto', (file) => {
    const source = readFileSync(join(WEB_ROOT, file), 'utf8')
    const byId = [...source.matchAll(/eq\(labReports\.id, params\.reportId\),/g)]
    expect(byId.length).toBeGreaterThan(0)
    for (const match of byId) {
      // Los filtros de una misma consulta van a continuación del id.
      const filters = source.slice(match.index, match.index + 320).split('.returning(')[0]!.split('.limit(')[0]!
      expect(filters).toContain('eq(labReports.organizationId, params.orgId)')
      expect(filters).toContain('eq(labReports.studyId, params.studyId)')
      expect(filters).toContain('eq(labReports.subjectId, params.subjectId)')
    }
  })

  it('la configuración del centro solo se escribe en la organización del token', () => {
    const route = readFileSync(join(WEB_ROOT, 'app/api/os/org-config/route.ts'), 'utf8')
    expect(route).toContain('await auth()')
    expect(route).toContain("allows(access, 'org.settings', canAdministerOrg)")
    expect(route).not.toMatch(/orgId: (body|parsed\.data)/)
    const service = readFileSync(join(WEB_ROOT, 'lib/os/org-admin-service.ts'), 'utf8')
    expect(countMatches(service, /organizationId: params\.orgId/g)).toBeGreaterThanOrEqual(countMatches(service, /\.insert\(/g))
    expect(countMatches(service, /eq\(organizations\.id, params\.orgId\)/g)).toBe(countMatches(service, /\.from\(organizations\)|\.update\(organizations\)/g))
    expect(service).toContain('eq(organizationIntegrations.organizationId, params.orgId)')
    expect(service).not.toMatch(/secretsEncrypted/)
  })

  it('las rutas de informes validan el sujeto contra el estudio de la URL', () => {
    const base = 'app/api/studies/[id]/subjects/[subjectId]/lab-reports'
    for (const file of ['route.ts', 'images/route.ts', '[reportId]/route.ts', '[reportId]/image/[page]/route.ts', '[reportId]/confirm/route.ts', '[reportId]/reject/route.ts', '[reportId]/export/route.ts']) {
      const route = readFileSync(join(WEB_ROOT, base, file), 'utf8')
      expect(route).toMatch(/validateSubjectAccess\(subjectId, studyId[,)]/)
      expect(route).not.toMatch(/orgId: (body|parsed\.data)/)
    }
  })

  it('las rutas de informes que MODIFICAN exigen labs.manage; las que solo leen, no', () => {
    const base = 'app/api/studies/[id]/subjects/[subjectId]/lab-reports'
    const requirement = "validateSubjectAccess(subjectId, studyId, { require: 'labs.manage' })"
    for (const file of ['route.ts', 'images/route.ts', '[reportId]/confirm/route.ts', '[reportId]/reject/route.ts']) {
      expect(readFileSync(join(WEB_ROOT, base, file), 'utf8'), file).toContain(requirement)
    }
    for (const file of ['[reportId]/route.ts', '[reportId]/image/[page]/route.ts', '[reportId]/export/route.ts']) {
      expect(readFileSync(join(WEB_ROOT, base, file), 'utf8'), file).not.toContain('require:')
    }
  })

  it('las rutas de agenda validan el estudio de la URL y no aceptan la organización del cuerpo', () => {
    for (const file of ['app/api/studies/[id]/agenda/route.ts', 'app/api/studies/[id]/agenda/[itemId]/route.ts']) {
      const route = readFileSync(join(WEB_ROOT, file), 'utf8')
      expect(route).toContain("validatePhiStudyAccess(studyId, { require: 'agenda.manage' })")
      expect(route).toContain('orgId: access.orgId')
      expect(route).not.toMatch(/orgId: (body|parsed\.data)/)
    }
  })

  it('la ruta del buscador toma la organización del token de Clerk', () => {
    const route = readFileSync(join(WEB_ROOT, 'app/api/search/route.ts'), 'utf8')
    expect(route).toContain('await auth()')
    expect(route).not.toMatch(/searchParams\.get\(['"](orgId|organizationId|organization_id)['"]\)/)
  })
})
