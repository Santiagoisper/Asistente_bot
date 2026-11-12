import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Leakage suite — alcance por estudio en listados y agregados
 * (docs/decisions/study-membership.md, paso 4).
 *
 * Los validadores cubren «entrar a un estudio». Estas pantallas y módulos
 * listan o cuentan sin pasar por un validador, así que cada consulta tiene que
 * llevar, además del filtro de organización, el del alcance de la persona. Si
 * alguien agrega una consulta sin él, este test rompe.
 */
const WEB_ROOT = join(__dirname, '..', '..')
const read = (file: string): string => readFileSync(join(WEB_ROOT, file), 'utf8')
const count = (source: string, pattern: RegExp): number => source.match(pattern)?.length ?? 0

/** Usos del filtro de alcance (no cuenta la línea de import). */
const scopeFilters = (source: string): number =>
  count(source, /studyScope(OrOrgLevel)?Filter\((scope|opts\.scope|params\.scope|ctx\.studyScope),/g)

describe('leakage — listados del OS filtrados por alcance', () => {
  it.each(['lib/os/inicio-data.ts', 'lib/os/search.ts'])('%s: cada consulta lleva el filtro de alcance', (file) => {
    const source = read(file)
    const wheres = count(source, /\.where\(/g)
    expect(wheres).toBeGreaterThan(0)
    expect(scopeFilters(source)).toBeGreaterThanOrEqual(wheres)
  })

  it('lib/os/inicio-data.ts: toda función que recibe la organización recibe también el alcance', () => {
    const source = read('lib/os/inicio-data.ts')
    const signatures = [...source.matchAll(/^(?:export )?async function (\w+)\(([^)]*)\)/gm)]
    expect(signatures.length).toBeGreaterThan(8)
    for (const [, name, params] of signatures) {
      if (params?.includes('orgId: string')) expect(params, name).toContain('scope: StudyScope')
    }
  })

  it('lib/agenda/agenda-service.ts: el listado de turnos se limita al alcance', () => {
    const source = read('lib/agenda/agenda-service.ts')
    const start = source.indexOf('export async function listAgenda(')
    const body = source.slice(start, source.indexOf('if (rows.length === 0) return []', start))
    expect(body).toContain('studyScopeFilter(params.scope, agendaItems.studyId)')
    expect(source).toMatch(/listAgendaDay\(params: \{ orgId: string; scope: StudyScope;/)
  })

  it.each(['app/(app)/studies/page.tsx', 'app/(app)/dashboard/page.tsx', 'app/(app)/library/page.tsx', 'app/(app)/admin/page.tsx'])(
    '%s: cada consulta lleva el filtro de alcance y la página no resuelve organización ni rol por su cuenta',
    (file) => {
      const source = read(file)
      const queries = count(source, /\.findMany\(/g)
      expect(queries).toBeGreaterThan(0)
      expect(scopeFilters(source)).toBeGreaterThanOrEqual(queries)
      expect(source).toContain('getOsContext()')
      expect(source).not.toMatch(/organizations\.findFirst|orgRole|from '@clerk\/nextjs\/server'/)
    },
  )

  it('el contexto del OS carga el alcance una sola vez y lo entrega a las pantallas', () => {
    const source = read('lib/os/context.ts')
    expect(source).toContain('loadStudyScope({ access, orgId: org.id, userId })')
    expect(source).toMatch(/studyScope: StudyScope/)
  })

  it('el buscador recibe el alcance desde la ruta', () => {
    const source = read('app/api/search/route.ts')
    expect(source).toContain('loadStudyScope({ access, orgId: org.id, userId })')
    expect(source).toMatch(/searchOs\(org\.id, query, \{[^}]*scope,/s)
  })
})
