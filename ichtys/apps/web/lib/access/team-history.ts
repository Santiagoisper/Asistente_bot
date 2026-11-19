import { and, auditLogs, db, desc, eq, inArray, lt } from '@ichtys/db'
import { parseMemberFunctions } from '@ichtys/auth/functions'
import type { MemberFunction } from '@ichtys/db'

/**
 * «Qué cambió y quién» en «Equipo y accesos» (docs/decisions/study-membership.md, paso 5).
 *
 * No hay tabla nueva: el historial es el registro de auditoría que ya escriben,
 * en la misma transacción que el cambio (R3), las rutas de funciones, de
 * estudios y de modo. Esta lectura:
 * - lleva siempre la organización: nunca devuelve una fila de otra;
 * - pide solo las acciones de accesos (lista cerrada, abajo);
 * - no reenvía `metadata` tal cual: arma cada entrada con los campos conocidos.
 *   Si mañana una ruta agrega algo a la metadata, no aparece solo en pantalla;
 * - deja afuera los pedidos que no cambiaron nada (`changed: false`): quedan
 *   en la auditoría, pero no son un cambio.
 */

export const ACCESS_HISTORY_ACTIONS = [
  'access.function.grant',
  'access.function.revoke',
  'access.membership.grant',
  'access.membership.update',
  'access.membership.revoke',
  'org.access_mode.update',
  'org.access_mode.deadline_set',
] as const

export type AccessHistoryAction = (typeof ACCESS_HISTORY_ACTIONS)[number]

/** Tope de entradas por página: el pedido puede pedir menos, nunca más. */
export const ACCESS_HISTORY_MAX_PAGE = 100

export interface AccessHistoryEntry {
  /** Identificador del registro de auditoría (sirve de cursor). */
  id: number
  at: string
  action: AccessHistoryAction
  /** Quién hizo el cambio. */
  actorUserId: string | null
  /** A quién le cambió el acceso (funciones y estudios). */
  memberUserId: string | null
  functionKey: MemberFunction | null
  studyId: string | null
  /** El cambio lo hizo la persona sobre sí misma (M13: permitido y auditado). */
  self: boolean
  /** Alta o cambio de estudio con fecha de vencimiento. */
  hasExpiry: boolean | null
  /** Paso de modo: de qué a qué. */
  modeFrom: 'open' | 'enforced' | null
  modeTo: 'open' | 'enforced' | null
  /** Plazo del modo abierto, cuando se fijó. */
  openUntil: string | null
}

export interface AccessHistoryCursor {
  id: number
}

export interface AccessHistoryPage {
  entries: AccessHistoryEntry[]
  /** Para pedir la página siguiente (más vieja); null si no hay más. */
  next: AccessHistoryCursor | null
}

/**
 * Cursor de página: el `id` de la última fila de auditoría leída. Se pagina por
 * `id` (bigserial) y no por fecha: `created_at` guarda microsegundos y un `Date`
 * de JS solo milisegundos, así que un cursor por fecha salteaba filas en el
 * borde de página (Architect y Devin en el #234). El `id` no se trunca nunca.
 */
export function encodeHistoryCursor(cursor: AccessHistoryCursor): string {
  return String(cursor.id)
}

export function decodeHistoryCursor(raw: string): AccessHistoryCursor | null {
  if (!/^[1-9]\d{0,14}$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) ? { id } : null
}

interface AuditRow {
  id: number
  action: string
  userId: string | null
  studyId: string | null
  metadata: unknown
  createdAt: Date
}

const isAction = (value: string): value is AccessHistoryAction =>
  (ACCESS_HISTORY_ACTIONS as readonly string[]).includes(value)

const asMode = (value: unknown): 'open' | 'enforced' | null =>
  value === 'open' || value === 'enforced' ? value : null

const asString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

const asIsoDate = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

/**
 * Una fila de auditoría → una entrada del historial, o null si no corresponde
 * mostrarla (otra acción, o un pedido que no cambió nada).
 */
export function toAccessHistoryEntry(row: AuditRow): AccessHistoryEntry | null {
  if (!isAction(row.action)) return null
  const meta = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {}
  if (meta['changed'] === false) return null

  // Una función que no está en la lista cerrada no se muestra como si lo estuviera.
  const {
    known: [functionKey],
  } = parseMemberFunctions(typeof meta['functionKey'] === 'string' ? [meta['functionKey']] : [])

  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    action: row.action,
    actorUserId: row.userId,
    memberUserId: asString(meta['memberUserId']),
    functionKey: functionKey ?? null,
    studyId: row.studyId,
    self: meta['selfAssigned'] === true || meta['selfRevoked'] === true,
    hasExpiry: typeof meta['hasExpiry'] === 'boolean' ? meta['hasExpiry'] : null,
    modeFrom: asMode(meta['from']),
    modeTo: asMode(meta['to']),
    openUntil: asIsoDate(meta['openUntil']),
  }
}

/** Cuántas lecturas hace como máximo para llenar una página visible. */
const MAX_BATCHES = 5

/**
 * Página del historial de accesos de una organización, de lo más nuevo a lo
 * más viejo (orden de inserción). `before` es el cursor que devolvió la página
 * anterior. Los pedidos sin cambio no ocupan lugar: si una lectura trae filas
 * que no se muestran, sigue leyendo hasta llenar la página (con un tope), para
 * que una página no llegue vacía con «Ver más».
 */
export async function loadAccessHistory(
  orgId: string,
  options: { limit: number; before?: AccessHistoryCursor | null },
): Promise<AccessHistoryPage> {
  const limit = Math.max(1, Math.min(ACCESS_HISTORY_MAX_PAGE, Math.trunc(options.limit)))
  const entries: AccessHistoryEntry[] = []
  let before = options.before?.id ?? null
  let more = true
  // Se lee de a lotes más grandes que la página: los pedidos sin cambio se descartan acá.
  const batchSize = Math.max(limit, 50)

  for (let batch = 0; batch < MAX_BATCHES && more && entries.length < limit; batch++) {
    const conditions = [eq(auditLogs.organizationId, orgId), inArray(auditLogs.action, [...ACCESS_HISTORY_ACTIONS])]
    if (before !== null) conditions.push(lt(auditLogs.id, before))

    const rows: AuditRow[] = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        userId: auditLogs.userId,
        studyId: auditLogs.studyId,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.id))
      .limit(batchSize + 1)

    more = rows.length > batchSize
    const batchRows = rows.slice(0, batchSize)
    for (const row of batchRows) {
      before = row.id
      const entry = toAccessHistoryEntry(row)
      if (entry) entries.push(entry)
      if (entries.length === limit) {
        // Página llena: si quedan filas sin leer en este lote, hay más.
        more = more || row !== batchRows[batchRows.length - 1]
        break
      }
    }
  }

  return { entries, next: more && before !== null ? { id: before } : null }
}
