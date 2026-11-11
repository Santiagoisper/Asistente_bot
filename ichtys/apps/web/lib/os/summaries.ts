import { cache } from 'react'
import { fetchModuleSummary, type ModuleSummaryResult, type OsModule } from '@ichtys/integrations'

/**
 * Resumen de un satélite, pedido una sola vez por request aunque lo usen
 * varios widgets del Inicio. fetchModuleSummary nunca lanza.
 */
export const loadModuleSummary = cache(
  (module: OsModule, userId: string, orgId: string): Promise<ModuleSummaryResult> =>
    fetchModuleSummary(module, { userId, orgId }),
)
