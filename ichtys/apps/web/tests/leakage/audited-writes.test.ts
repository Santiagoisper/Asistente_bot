import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Leakage suite — auditoría dentro de la transacción (regla R3 del marco
 * normativo, brecha C1).
 *
 * Tripwire estático. Una ruta que modifica datos no puede guardar el dato y
 * después llamar a `writeAuditLog` como paso aparte: si esa segunda escritura
 * falla, el dato queda guardado sin rastro de quién lo hizo. Tiene que usar
 * `auditedWrite` (o `insertAuditLog` dentro de su transacción).
 *
 * - MIGRATED: rutas ya corregidas. No pueden volver atrás.
 * - PENDING: rutas que todavía auditan fuera de la transacción. La lista es
 *   exacta: una ruta nueva que caiga en el patrón rompe el test, y una ruta
 *   que se corrige obliga a sacarla de acá.
 * - FAILURE_AUDIT_ONLY: rutas ya corregidas que conservan una auditoría suelta
 *   para registrar una falla, donde no se guardó ningún dato.
 *
 * El borrado de la evidencia de un informe (política `purge`) tiene su propia
 * guarda abajo: un solo lugar, siempre dentro de una transacción.
 *
 * El chat guarda cada mensaje con su registro dentro de `lib/chat/persistence`
 * (lo prueba `lib/chat/__tests__/persistence-audit.test.ts`); crear la
 * conversación no lleva registro propio: queda cubierta por el del primer pedido.
 *
 * Límites de este tripwire (la garantía real son las pruebas de
 * comportamiento de lib/audit y las de punta a punta de lib/labs):
 * - Busca el texto literal `db.insert|update|delete` y `writeAuditLog`; un
 *   alias o un cambio de nombre lo esquivan.
 * - Detecta «escribir y auditar por separado», no «escribir y no auditar
 *   nunca». Escrituras conocidas sin registro propio, a decidir en el marco:
 *   la re-extracción de un protocolo (`spec/reextract`) y el título automático
 *   de una conversación. La instantánea que guarda `screening` vive en un GET y en un
 *   servicio, fuera de este escaneo: su registro en la misma transacción lo
 *   prueba `lib/subjects/__tests__/screening-service.test.ts`.
 *
 * El perfil del sujeto tiene su propia guarda abajo: dentro de la aplicación
 * (`app/` y `lib/`) se escribe en un solo lugar y ese lugar exige el registro.
 * La guarda no mira `ichtys/scripts/`: tres scripts de operación y de prueba
 * (`backfill-lab-review-pending`, `consolidate-single-org`, `e2e-product-loop`)
 * escriben la tabla directo y sin registro. No los dispara ninguna ruta;
 * queda pendiente decidir si un script que toca dato clínico también registra.
 */
const WEB_ROOT = join(__dirname, '..', '..')
const API_ROOT = join(WEB_ROOT, 'app', 'api')

const MIGRATED = [
  'app/api/studies/[id]/agenda/route.ts',
  'app/api/studies/[id]/agenda/[itemId]/route.ts',
  'app/api/studies/[id]/subjects/route.ts',
  'app/api/studies/[id]/subjects/[subjectId]/evolutions/route.ts',
  'app/api/studies/[id]/subjects/[subjectId]/lab-reports/route.ts',
  'app/api/studies/[id]/subjects/[subjectId]/lab-reports/images/route.ts',
  'app/api/studies/[id]/subjects/[subjectId]/lab-reports/[reportId]/confirm/route.ts',
  'app/api/studies/[id]/subjects/[subjectId]/lab-reports/[reportId]/reject/route.ts',
  'app/api/studies/[id]/subjects/[subjectId]/labs/extract/route.ts',
  'app/api/studies/[id]/subjects/[subjectId]/labs/confirm/route.ts',
  'app/api/studies/[id]/subjects/[subjectId]/labs/reject/route.ts',
  'app/api/studies/[id]/subjects/[subjectId]/profile/proposals/[evolutionId]/confirm/route.ts',
  'app/api/studies/[id]/subjects/[subjectId]/profile/proposals/[evolutionId]/reject/route.ts',
  'app/api/os/org-config/route.ts',
  'app/api/chat/stream/route.ts',
  'app/api/org/settings/route.ts',
  'app/api/studies/[id]/spec/[specId]/route.ts',
] as const

/** Ruta y verbo → por qué sigue pendiente. Hoy no queda ninguna. */
const PENDING: Record<string, string> = {}

/**
 * Rutas que escriben con su registro dentro de la transacción y además
 * registran, suelto, que algo falló. Ese registro no acompaña a ningún dato
 * (no se guardó nada), así que no hay transacción que compartir. La lista de
 * acciones permitidas es exacta: cualquier otra auditoría suelta rompe el test.
 */
const FAILURE_AUDIT_ONLY: Record<string, readonly string[]> = {
  'app/api/chat/route.ts POST': ['rag.answer.failed'],
}

/** Acción de cada auditoría suelta de un manejador (`writeAuditLog({ action: '…'`). */
function looseAuditActions(body: string): string[] {
  return [...body.matchAll(/\b(?:safeWriteAuditLog|writeAuditLog)\s*\(\s*\{\s*action:\s*'([^']+)'/g)].map((match) => match[1]!)
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : routeFiles(full)
    return entry.name === 'route.ts' ? [full] : []
  })
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Cuerpo de cada manejador exportado, por verbo. */
function handlers(source: string): Array<{ verb: string; body: string }> {
  // Las dos formas válidas de exportar un manejador: función o constante.
  const parts = withoutComments(source).split(/^export (?:(?:async )?function|const) (GET|POST|PUT|PATCH|DELETE)\b/m)
  const found: Array<{ verb: string; body: string }> = []
  for (let index = 1; index < parts.length; index += 2) found.push({ verb: parts[index]!, body: parts[index + 1]! })
  return found
}

// Una auditoría suelta se puede escribir de dos maneras: con el ayudante o insertando directo en la tabla.
const LOOSE_AUDIT = /\b(?:safeWriteAuditLog|writeAuditLog)\s*\(|\bdb\s*\.\s*insert\(\s*auditLogs\s*\)/
const LOOSE_WRITE = /\bdb\s*\.\s*(?:insert|update|delete)\s*\(/

describe('leakage — la auditoría de una escritura va en su misma transacción', () => {
  it.each(MIGRATED)('%s: no escribe por la conexión suelta ni audita como paso aparte', (file) => {
    const source = readFileSync(join(WEB_ROOT, file), 'utf8')
    const mutations = handlers(source).filter((handler) => handler.verb !== 'GET')
    expect(mutations.length).toBeGreaterThan(0)
    expect(withoutComments(source)).not.toMatch(LOOSE_WRITE)
    for (const handler of mutations) {
      expect(`${handler.verb}: ${LOOSE_AUDIT.test(handler.body)}`).toBe(`${handler.verb}: false`)
    }
  })

  it('las rutas que todavía auditan fuera de la transacción son exactamente las pendientes', () => {
    const found = routeFiles(API_ROOT)
      .flatMap((full) => {
        const file = relative(WEB_ROOT, full).split(sep).join('/')
        return handlers(readFileSync(full, 'utf8'))
          .filter((handler) => handler.verb !== 'GET' && LOOSE_AUDIT.test(handler.body))
          .map((handler) => `${file} ${handler.verb}`)
      })
      .sort()
    expect(found).toEqual([...Object.keys(PENDING), ...Object.keys(FAILURE_AUDIT_ONLY)].sort())
  })

  it.each(Object.entries(FAILURE_AUDIT_ONLY))('%s: la única auditoría suelta es la de una falla, y no escribe por la conexión suelta', (key, allowed) => {
    const [file, verb] = key.split(' ') as [string, string]
    const source = readFileSync(join(WEB_ROOT, file), 'utf8')
    const handler = handlers(source).find((candidate) => candidate.verb === verb)
    expect(handler).toBeDefined()
    expect(withoutComments(source)).not.toMatch(LOOSE_WRITE)
    // Tantas acciones reconocidas como llamadas sueltas: ninguna se escapa del patrón.
    const calls = handler!.body.match(new RegExp(LOOSE_AUDIT.source, 'g')) ?? []
    expect(looseAuditActions(handler!.body)).toHaveLength(calls.length)
    expect(looseAuditActions(handler!.body).sort()).toEqual([...allowed].sort())
  })

  it('el perfil del sujeto se escribe en un solo lugar, que exige el registro de auditoría', () => {
    // Fuera de `updatePatientProfile` nadie modifica `patientProfiles`. El alta
    // de sujeto crea la fila vacía dentro de su propia escritura auditada.
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) return ['__tests__', 'node_modules', '.next'].includes(entry.name) ? [] : sources(full)
        return /\.tsx?$/.test(entry.name) ? [full] : []
      })
    const writers = [join(WEB_ROOT, 'app'), join(WEB_ROOT, 'lib')]
      .flatMap(sources)
      .filter((full) => /\.update\(\s*patientProfiles\s*\)/.test(withoutComments(readFileSync(full, 'utf8'))))
      .map((full) => relative(WEB_ROOT, full).split(sep).join('/'))
    expect(writers).toEqual(['lib/subjects/patient-profile-service.ts'])

    const service = withoutComments(readFileSync(join(WEB_ROOT, 'lib/subjects/patient-profile-service.ts'), 'utf8'))
    // La escritura entra por la transacción y lleva su registro; no hay escritura por la conexión suelta.
    expect(service).toMatch(/tx\s*\.update\(patientProfiles\)/)
    expect(service).toMatch(/insertAuditLog\(tx, audit\(next\)\)/)
    expect(service).not.toMatch(/\bdb\s*\.\s*update\(/)
    // El registro es un parámetro obligatorio, no opcional.
    expect(service).toMatch(/audit: \(next: PatientProfile\) => AuditLogParams,\n\): Promise<PatientProfile>/)
  })

  it('la evidencia de un informe de laboratorio se borra en un solo lugar, dentro de una transacción', () => {
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) return ['__tests__', 'node_modules', '.next'].includes(entry.name) ? [] : sources(full)
        return /\.tsx?$/.test(entry.name) ? [full] : []
      })
    const deleters = [join(WEB_ROOT, 'app'), join(WEB_ROOT, 'lib')]
      .flatMap(sources)
      .filter((full) => /\.delete\(\s*labReportImages\s*\)/.test(withoutComments(readFileSync(full, 'utf8'))))
      .map((full) => relative(WEB_ROOT, full).split(sep).join('/'))
    expect(deleters).toEqual(['lib/labs/lab-report-service.ts'])

    const service = withoutComments(readFileSync(join(WEB_ROOT, 'lib/labs/lab-report-service.ts'), 'utf8'))
    expect(service).toMatch(/tx\s*\.delete\(labReportImages\)/)
    expect(service).not.toMatch(/\bdb\s*\.\s*delete\(/)
  })

  it('el detector reconoce el patrón que busca', () => {
    const bad = "export async function POST() {\n  const [row] = await db.insert(t).values({}).returning()\n  await writeAuditLog({ action: 'x' })\n}\n"
    const commented = "export async function POST() {\n  // await writeAuditLog({ action: 'x' })\n  return auditedWrite(w, a)\n}\n"
    expect(handlers(bad).map((handler) => LOOSE_AUDIT.test(handler.body))).toEqual([true])
    expect(LOOSE_WRITE.test(withoutComments(bad))).toBe(true)
    expect(handlers(commented).map((handler) => LOOSE_AUDIT.test(handler.body))).toEqual([false])
    expect(handlers("export async function GET() {\n  await writeAuditLog({ action: 'view' })\n}\n")[0]?.verb).toBe('GET')
    const direct = "export async function PATCH() {\n  await save()\n  await db.insert(auditLogs).values({ action: 'x' })\n}\n"
    expect(handlers(direct).map((handler) => LOOSE_AUDIT.test(handler.body))).toEqual([true])
    const arrow = "export const POST = async () => {\n  await db.insert(t).values({})\n  await writeAuditLog({ action: 'x' })\n}\n"
    expect(handlers(arrow).map((handler) => `${handler.verb}:${LOOSE_AUDIT.test(handler.body)}`)).toEqual(['POST:true'])
  })
})
