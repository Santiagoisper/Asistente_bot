import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Leakage suite — cobertura de auth en rutas API (SECURITY.md §5 "Auth guards").
 *
 * Bloqueante para release. Tripwire estático: TODA route handler bajo app/api
 * debe referenciar al menos un mecanismo de autenticación/autorización
 * conocido. Si alguien agrega una ruta nueva sin guard, este test rompe y
 * obliga a elegir un mecanismo explícito (o a documentarla en la allowlist).
 *
 * Complementa (no reemplaza) los tests unitarios por ruta: esto garantiza que
 * ninguna ruta quede FUERA del radar de auth por accidente.
 */

const WEB_ROOT = join(__dirname, '..', '..')
const API_ROOT = join(WEB_ROOT, 'app', 'api')

/** Tokens que evidencian un guard de auth/authz server-side en el archivo. */
const AUTH_TOKENS = [
  'validateStudyAccess(',
  'validatePhiStudyAccess(',
  'validateDocumentAccess(',
  'validateDocumentVersionAccess(',
  'validateMessageAccess(',
  'validateConversationAccess(',
  'validateSubjectAccess(',
  'validateDocumentPageAccess(',
  'resolveOrgContext(',
  'resolveOrProvisionOrganization(',
  'await auth()',
  'CRON_SECRET',
] as const

/**
 * Rutas cuya auth vive fuera del archivo de la ruta. Cada entrada exige un
 * token alternativo que pruebe el control compensatorio.
 */
const DELEGATED_AUTH_ALLOWLIST: Record<string, string> = {
  // Endpoint interno de testing: gate por feature flag explícito; la
  // validación de tenant ocurre dentro de generateAnswerForStudy()
  // (lib/rag/answer-orchestrator → validateStudyAccess).
  'app/api/rag/answer-test/route.ts': 'ENABLE_INTERNAL_RAG_ANSWER_TEST',
}

/** Rutas públicas permitidas en el matcher de middleware.ts — revisar a mano al cambiar. */
const EXPECTED_PUBLIC_ROUTES = [
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/trust',
  '/pricing',
  '/terms',
  '/privacy',
  '/roi',
  '/api/cron(.*)',
] as const

function findRouteFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...findRouteFiles(full))
    } else if (entry === 'route.ts' || entry === 'route.tsx') {
      found.push(full)
    }
  }
  return found
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

describe('leakage — API auth coverage', () => {
  const routeFiles = findRouteFiles(API_ROOT)

  it('finds API routes to audit (sanity)', () => {
    expect(routeFiles.length).toBeGreaterThan(10)
  })

  for (const file of routeFiles) {
    const relPath = toPosix(relative(WEB_ROOT, file))

    it(`${relPath} references a server-side auth guard`, () => {
      const source = readFileSync(file, 'utf8')

      const delegatedToken = DELEGATED_AUTH_ALLOWLIST[relPath]
      if (delegatedToken) {
        expect(
          source.includes(delegatedToken),
          `${relPath} está en la allowlist pero perdió su control compensatorio "${delegatedToken}"`,
        ).toBe(true)
        return
      }

      const hasGuard = AUTH_TOKENS.some((token) => source.includes(token))
      expect(
        hasGuard,
        `${relPath} no referencia ningún guard de auth conocido (${AUTH_TOKENS.join(', ')}). ` +
          'Agregá un guard server-side o documentá la delegación en DELEGATED_AUTH_ALLOWLIST.',
      ).toBe(true)
    })
  }
})

describe('leakage — middleware public-route allowlist', () => {
  it('isPublicRoute only contains the reviewed public routes', () => {
    const middlewareSource = readFileSync(join(WEB_ROOT, 'middleware.ts'), 'utf8')

    // Extrae los literales dentro de createRouteMatcher([...]).
    const matcherBlock = middlewareSource.match(/createRouteMatcher\(\[(.*?)\]\)/s)?.[1]
    expect(matcherBlock, 'middleware.ts debe definir createRouteMatcher([...])').toBeDefined()

    const declaredRoutes = Array.from(
      (matcherBlock as string).matchAll(/'([^']+)'/g),
      (match) => match[1],
    ).filter((route): route is string => typeof route === 'string')

    // Toda ruta pública declarada tiene que estar en la lista revisada…
    for (const route of declaredRoutes) {
      expect(
        EXPECTED_PUBLIC_ROUTES.includes(route as (typeof EXPECTED_PUBLIC_ROUTES)[number]),
        `Ruta pública no revisada en middleware.ts: "${route}". ` +
          'Si es intencional, actualizá EXPECTED_PUBLIC_ROUTES en este test (revisión consciente).',
      ).toBe(true)
    }

    // …y ninguna ruta pública puede ser un catch-all de API.
    for (const route of declaredRoutes) {
      if (route.startsWith('/api')) {
        expect(route).toBe('/api/cron(.*)')
      }
    }
  })
})
