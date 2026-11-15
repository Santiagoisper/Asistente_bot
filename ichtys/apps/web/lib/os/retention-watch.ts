import { and, auditLogs, db, desc, eq, isNull } from '@ichtys/db'
import type { PriorityItem } from './priority'

/**
 * Vigía de la tarea diaria que borra las grabaciones vencidas (D14 de
 * docs/decisions/consulta-dictada.md; docs/decisions/borrado-de-grabaciones-verificacion.md).
 *
 * La tarea corre una vez por día. Si el secreto falta o no coincide, responde 401 y no borra
 * nada, sin que nadie se entere. Por eso cada corrida deja un registro (`retention.run`) y
 * Inicio avisa, a quien administra el centro, cuando ese registro falta o es viejo.
 */

/** Un día y medio: una corrida salteada ya se avisa; un atraso de horas, no. */
export const RETENTION_RUN_MAX_AGE_HOURS = 36

type Reader = Pick<typeof db, 'select'>

/** Cuándo corrió por última vez la tarea, según su propio registro. `null` si no hay ninguno. */
export async function lastRetentionRun(reader: Reader = db): Promise<Date | null> {
  const rows = await reader
    .select({ createdAt: auditLogs.createdAt })
    .from(auditLogs)
    // El registro de una corrida no es de ninguna organización: así la búsqueda usa el índice.
    .where(and(isNull(auditLogs.organizationId), eq(auditLogs.action, 'retention.run')))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1)
  return rows[0]?.createdAt ?? null
}

const dateTime = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}

/** El aviso para Inicio, o `null` si la última corrida es reciente. */
export function retentionRunItem(lastRunAt: Date | null, now: Date): PriorityItem | null {
  const limitMs = RETENTION_RUN_MAX_AGE_HOURS * 60 * 60 * 1000
  if (lastRunAt && now.getTime() - lastRunAt.getTime() <= limitMs) return null
  return {
    id: 'system:retention-run',
    kind: 'system',
    severity: 'high',
    title: 'El borrado diario de grabaciones no está corriendo',
    // Corto: la lista de Inicio muestra el detalle en un renglón.
    detail: lastRunAt
      ? `Última corrida: ${dateTime(lastRunAt)}. Puede haber grabaciones vencidas sin borrar.`
      : 'Sin registro de corridas. Puede haber grabaciones vencidas sin borrar.',
    href: '/settings',
    since: lastRunAt ? lastRunAt.toISOString() : null,
  }
}
