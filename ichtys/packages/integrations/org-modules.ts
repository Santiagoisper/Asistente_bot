import type { OsModule } from './summary-schema'

/** Lo que el núcleo necesita saber de una fila de `organization_integrations`. */
export interface OrgIntegrationRow {
  category: 'module' | 'connector'
  integrationKey: string
  baseUrl: string | null
  enabled: boolean
  simulated: boolean
}

/**
 * URL del módulo para esta organización, o null si no lo tiene. Sin fila,
 * apagado o sin URL es lo mismo: el módulo no existe para ese centro. No se
 * valida acá: lo hace quien la usa, con las mismas reglas que cualquier URL.
 */
export function orgModuleUrl(rows: readonly OrgIntegrationRow[], module: OsModule): string | null {
  const row = rows.find((candidate) => candidate.category === 'module' && candidate.integrationKey === module)
  if (!row || !row.enabled) return null
  const url = row.baseUrl?.trim()
  return url ? url : null
}

export interface OrgConnector {
  integrationKey: string
  baseUrl: string | null
  /** Conector de demostración: nunca se presenta como un sistema real. */
  simulated: boolean
}

/** Conectores a sistemas de destino habilitados para la organización. */
export function orgConnectors(rows: readonly OrgIntegrationRow[]): OrgConnector[] {
  return rows
    .filter((row) => row.category === 'connector' && row.enabled)
    .map((row) => ({ integrationKey: row.integrationKey, baseUrl: row.baseUrl, simulated: row.simulated }))
}
