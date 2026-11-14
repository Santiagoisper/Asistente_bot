import { and, eq, isNull } from 'drizzle-orm'
import { db, memberFunctions } from '@ichtys/db'
import { parseAccessMode, parseMemberFunctions, type AccessSubject } from './functions'
import { ROLES, type Role } from './roles'

/**
 * Arma lo que hace falta saber de una persona para decidir capacidades
 * (docs/decisions/study-membership.md): el modo de su organización, su rol
 * histórico y sus funciones vigentes.
 *
 * - Modo `open`: las funciones no deciden nada, así que NO se consultan. El
 *   costo y el comportamiento son los de antes de que existiera este módulo.
 * - Modo `enforced`: se leen las funciones vigentes (sin baja). Un nombre que
 *   el código no conoce no da capacidades.
 * - M14: quien es administrador de la organización en el proveedor de
 *   identidad conserva siempre `platform_admin`, para que nunca quede una
 *   organización sin nadie que pueda asignar funciones. Esa función no trae
 *   datos clínicos ni entrada a estudios.
 *
 * `org.accessMode` se acepta como `unknown` a propósito: si falta o trae un
 * valor raro, `parseAccessMode` restringe.
 *
 * M20 (revisa M8): el plazo del modo abierto (`accessOpenUntil`) NO cambia el
 * modo. Vencido el plazo la organización sigue en `open` hasta que una persona
 * con administración de accesos la pase a `enforced`; la pantalla lo avisa.
 * El modo lo decide la columna y nada más. Motivo: lo que M8 y M15 prometían
 * para el vencimiento (avisos previos y función provisoria para quien venía
 * evolucionando) no está construido, y sin eso el paso automático dejaba a
 * médicos sin poder evolucionar de un día para el otro.
 */
export async function loadAccessSubject(params: {
  org: { id: string; accessMode?: unknown; accessOpenUntil?: unknown }
  userId: string
  role: Role
}): Promise<AccessSubject> {
  const mode = parseAccessMode(params.org.accessMode)
  if (mode === 'open') return { mode, role: params.role, functions: [] }

  const rows = await db
    .select({ functionKey: memberFunctions.functionKey })
    .from(memberFunctions)
    .where(
      and(
        eq(memberFunctions.organizationId, params.org.id),
        eq(memberFunctions.userId, params.userId),
        isNull(memberFunctions.revokedAt),
      ),
    )

  const { known, unknown } = parseMemberFunctions(rows.map((row) => row.functionKey))
  if (unknown.length > 0) {
    // Sin datos de la persona: solo cuántas, para que el desfase se note.
    console.warn(`[auth] ${unknown.length} función(es) con nombre desconocido ignoradas`)
  }
  if (params.role === ROLES.ORG_ADMIN && !known.includes('platform_admin')) known.push('platform_admin')

  return { mode, role: params.role, functions: known }
}
