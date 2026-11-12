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
 */
const WEB_ROOT = join(__dirname, '..', '..')
const API_ROOT = join(WEB_ROOT, 'app', 'api')

const MIGRATED = [
  'app/api/studies/[id]/agenda/route.ts',
  'app/api/studies/[id]/agenda/[itemId]/route.ts',
  'app/api/studies/[id]/subjects/route.ts',
  'app/api/studies/[id]/subjects/[subjectId]/evolutions/route.ts',
  'app/api/studies/[id]/subjects/[subjectId]/lab-reports/[reportId]/confirm/route.ts',
  'app/api/studies/[id]/subjects/[subjectId]/lab-reports/[reportId]/reject/route.ts',
] as const

/** Ruta y verbo → por qué sigue pendiente. */
const PENDING: Record<string, string> = {
  'app/api/chat/route.ts POST': 'registra el pedido y el resultado de una respuesta; guarda mensajes aparte',
  'app/api/chat/stream/route.ts POST': 'ídem, en la variante por flujo',
  'app/api/os/org-config/route.ts PUT': 'configuración del centro: guarda y después audita',
  'app/api/studies/[id]/subjects/[subjectId]/lab-reports/route.ts POST': 'alta de informe desde PDF: el servicio guarda y la ruta audita después',
  'app/api/studies/[id]/subjects/[subjectId]/lab-reports/images/route.ts POST': 'alta de informe desde imagen: ídem',
  'app/api/studies/[id]/subjects/[subjectId]/labs/confirm/route.ts POST': 'circuito anterior de laboratorio (perfil del sujeto)',
  'app/api/studies/[id]/subjects/[subjectId]/labs/extract/route.ts POST': 'circuito anterior de laboratorio',
  'app/api/studies/[id]/subjects/[subjectId]/labs/reject/route.ts POST': 'circuito anterior de laboratorio',
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
  const parts = withoutComments(source).split(/^export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/m)
  const found: Array<{ verb: string; body: string }> = []
  for (let index = 1; index < parts.length; index += 2) found.push({ verb: parts[index]!, body: parts[index + 1]! })
  return found
}

const LOOSE_AUDIT = /\b(?:safeWriteAuditLog|writeAuditLog)\s*\(/
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
    expect(found).toEqual(Object.keys(PENDING).sort())
  })

  it('el detector reconoce el patrón que busca', () => {
    const bad = "export async function POST() {\n  const [row] = await db.insert(t).values({}).returning()\n  await writeAuditLog({ action: 'x' })\n}\n"
    const commented = "export async function POST() {\n  // await writeAuditLog({ action: 'x' })\n  return auditedWrite(w, a)\n}\n"
    expect(handlers(bad).map((handler) => LOOSE_AUDIT.test(handler.body))).toEqual([true])
    expect(LOOSE_WRITE.test(withoutComments(bad))).toBe(true)
    expect(handlers(commented).map((handler) => LOOSE_AUDIT.test(handler.body))).toEqual([false])
    expect(handlers("export async function GET() {\n  await writeAuditLog({ action: 'view' })\n}\n")[0]?.verb).toBe('GET')
  })
})
