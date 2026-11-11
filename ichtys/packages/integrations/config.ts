import type { OsModule } from './summary-schema'

export const MODULE_URL_ENV: Record<OsModule, string> = {
  queries: 'OS_QUERIES_URL',
  viaticos: 'OS_VIATICOS_URL',
  operacion: 'OS_OPERACION_URL',
}
export const SIGNING_KEY_ENV = 'OS_SIGNING_PRIVATE_KEY'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Valida una URL base. Se exige https salvo en la máquina local, para que el
 * token nunca viaje en claro, y no se aceptan credenciales embebidas.
 */
export function parseModuleBaseUrl(raw: string | null | undefined): URL | null {
  const text = raw?.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  const local = LOCAL_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null
  if (url.username || url.password) return null
  return url
}

/**
 * URL base del satélite tomada de la instalación (variable de entorno), o null.
 * Solo para desarrollo y pruebas: en una instalación con varios centros la URL
 * sale de la organización.
 */
export function resolveModuleBaseUrl(
  module: OsModule,
  env: Record<string, string | undefined>,
): URL | null {
  return parseModuleBaseUrl(env[MODULE_URL_ENV[module]])
}

export function summaryUrl(base: URL): string {
  const path = base.pathname.replace(/\/+$/, '')
  return new URL(`${path}/api/os/summary`, base).toString()
}
