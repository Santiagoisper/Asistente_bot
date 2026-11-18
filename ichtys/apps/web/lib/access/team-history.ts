import { and, auditLogs, db, desc, eq, inArray, lt } from '@ichtys/db'
// `or` no está re-exportado por @ichtys/db (sumarlo toca packages/db); mismo camino que voided-origin-store.
import { or } from 'drizzle-orm'
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
  /** Identificador del registro de auditoría (sirve de cursor junto con `at`). */
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
  at: Date
  id: number
}

export interface AccessHistoryPage {
  entries: AccessHistoryEntry[]
  /** Para pedir la página siguiente (más vieja); null si no hay más. */
  next: AccessHistoryCursor | null
}

/** Cursor opaco para la URL: `<fecha ISO>_<id>`. */
export function encodeHistoryCursor(cursor: AccessHistoryCursor): string {
  return `${cursor.at.toISOString()}_${cursor.id}`
}

export function decodeHistoryCursor(raw: string): AccessHistoryCursor | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)_(\d{1,15})$/.exec(raw)
  if (!match) return null
  const at = new Date(match[1]!)
  const id = Number(match[2])
  if (Number.isNaN(at.getTime()) || !Number.isSafeInteger(id)) return null
  return { at, id }
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

/**
 * Página del historial de accesos de una organización, de lo más nuevo a lo
 * más viejo. `before` es el cursor que devolvió la página anterior.
 */
export async function loadAccessHistory(
  orgId: string,
  options: { limit: number; before?: AccessHistoryCursor | null },
): Promise<AccessHistoryPage> {
  const limit = Math.max(1, Math.min(ACCESS_HISTORY_MAX_PAGE, Math.trunc(options.limit)))
  const conditions = [eq(auditLogs.organizationId, orgId), inArray(auditLogs.action, [...ACCESS_HISTORY_ACTIONS])]
  if (options.before) {
    const { at, id } = options.before
    conditions.push(or(lt(auditLogs.createdAt, at), and(eq(auditLogs.createdAt, at), lt(auditLogs.id, id)))!)
  }

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
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    entries: page.map((row) => toAccessHistoryEntry(row)).filter((entry): entry is AccessHistoryEntry => entry !== null),
    next: rows.length > limit && last ? { at: last.createdAt, id: last.id } : null,
  }
}
