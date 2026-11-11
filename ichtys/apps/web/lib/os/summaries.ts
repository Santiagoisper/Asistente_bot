import { cache } from 'react'
import { fetchModuleSummary, orgModuleUrl, type ModuleSummaryResult, type OsModule } from '@ichtys/integrations'
import { loadOrgIntegrations } from './org-integrations'

/**
 * Resumen de un satélite, pedido una sola vez por request aunque lo usen
 * varios widgets del Inicio. La URL sale de la organización: un centro sin ese
 * módulo no lo ve, aunque otro centro de la misma instalación lo tenga.
 * Nunca lanza: si no se puede leer la configuración, el módulo figura sin conectar.
 */
export const loadModuleSummary = cache(async (module: OsModule, userId: string, orgId: string): Promise<ModuleSummaryResult> => {
  let baseUrl: string | null
  try {
    baseUrl = orgModuleUrl(await loadOrgIntegrations(orgId), module)
  } catch {
    console.error('[os] no se pudo leer la configuración de integraciones')
    baseUrl = null
  }
  // Solo en la máquina de desarrollo, un centro sin fila usa las OS_*_URL de la
  // instalación. En producción y en preview eso mezclaría centros.
  if (baseUrl === null && process.env.NODE_ENV === 'development') return fetchModuleSummary(module, { userId, orgId })
  return fetchModuleSummary(module, { userId, orgId, baseUrl })
})
