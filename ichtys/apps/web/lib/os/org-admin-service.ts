import { and, eq, organizationIntegrations, organizations, type OrgOsSettings } from '@ichtys/db'
import type { OsModule } from '@ichtys/integrations'
import type { DbExecutor } from '../audit/audited-write'

/**
 * Guarda la conexión de un módulo para la organización. Una fila por módulo y
 * organización: si ya existe se actualiza, siempre dentro de la misma organización.
 * Corre sobre el `executor` que recibe: la ruta le pasa la transacción donde
 * también queda el registro de auditoría (R3).
 */
export async function saveOrgModule(params: { executor: DbExecutor; orgId: string; userId: string; module: OsModule; baseUrl: string | null; enabled: boolean }): Promise<void> {
  const saved = await params.executor
    .insert(organizationIntegrations)
    .values({
      organizationId: params.orgId,
      category: 'module',
      integrationKey: params.module,
      baseUrl: params.baseUrl,
      enabled: params.enabled,
      createdBy: params.userId,
    })
    .onConflictDoUpdate({
      target: [organizationIntegrations.organizationId, organizationIntegrations.integrationKey],
      set: { baseUrl: params.baseUrl, enabled: params.enabled, updatedBy: params.userId, updatedAt: new Date() },
      // Una fila de conector con la misma clave no se pisa desde acá.
      setWhere: and(eq(organizationIntegrations.organizationId, params.orgId), eq(organizationIntegrations.category, 'module')),
    })
    .returning({ id: organizationIntegrations.id })
  if (saved.length === 0) throw new Error('integration_key_taken')
}

/** Guarda o quita la zona horaria del centro, conservando el resto de sus ajustes. */
export async function saveOrgTimeZone(params: { executor: DbExecutor; orgId: string; timeZone: string | null }): Promise<void> {
  const [row] = await params.executor.select({ osSettings: organizations.osSettings }).from(organizations).where(eq(organizations.id, params.orgId)).limit(1)
  const next: OrgOsSettings = { ...(row?.osSettings ?? {}) }
  if (params.timeZone) next.timeZone = params.timeZone
  else delete next.timeZone
  await params.executor
    .update(organizations)
    .set({ osSettings: Object.keys(next).length > 0 ? next : null, updatedAt: new Date() })
    .where(eq(organizations.id, params.orgId))
}
