import { cache } from 'react'
import { db, eq, organizationIntegrations } from '@ichtys/db'
import type { OrgIntegrationRow } from '@ichtys/integrations'

/**
 * Integraciones de la organización, leídas una sola vez por pedido. Solo trae
 * lo que el núcleo necesita: nunca las credenciales cifradas.
 */
export const loadOrgIntegrations = cache(async (orgId: string): Promise<OrgIntegrationRow[]> => {
  return db
    .select({
      category: organizationIntegrations.category,
      integrationKey: organizationIntegrations.integrationKey,
      baseUrl: organizationIntegrations.baseUrl,
      enabled: organizationIntegrations.enabled,
      simulated: organizationIntegrations.simulated,
    })
    .from(organizationIntegrations)
    .where(eq(organizationIntegrations.organizationId, orgId))
})
