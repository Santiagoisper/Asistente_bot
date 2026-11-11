import type { OsModule } from './summary-schema'

export const MODULE_URL_ENV: Record<OsModule, string> = {
  queries: 'OS_QUERIES_URL',
  viaticos: 'OS_VIATICOS_URL',
  operacion: 'OS_OPERACION_URL',
}
export const SIGNING_KEY_ENV = 'OS_SIGNING_PRIVATE_KEY'

export interface ModuleUrlRules {
  /** Solo en la máquina de desarrollo: acepta localhost y redes privadas, y http hacia ellos. */
  allowLocal?: boolean
}

/** Loopback, redes privadas, enlace local y metadatos de nube: destinos que un centro no puede pedir. */
function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  }
  if (!host.includes(':')) return false
  // IPv6: loopback, sin especificar, locales únicas (fc00::/7), enlace local (fe80::/10) y v4 mapeadas.
  return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:')
}

/**
 * Valida una URL base. Se exige https, para que el token nunca viaje en claro.
 * No se aceptan credenciales embebidas, ni parámetros ni fragmento: la URL se
 * guarda sin cifrar y un token ahí quedaría expuesto. Los destinos locales
 * (loopback y redes privadas) solo valen con `allowLocal`, que es la máquina
 * de desarrollo: en un servidor serían una puerta a su red interna.
 * No resuelve DNS: un nombre público que apunte a una red privada no se detecta acá.
 */
export function parseModuleBaseUrl(raw: string | null | undefined, rules: ModuleUrlRules = {}): URL | null {
  const text = raw?.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  const local = isLocalHost(url.hostname)
  if (local && !rules.allowLocal) return null
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null
  if (url.username || url.password) return null
  if (url.search || url.hash) return null
  return url
}

/** La forma en que se guarda: origen y ruta, sin barra final. */
export function moduleBaseUrlText(url: URL): string {
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/**
 * URL base del satélite tomada de la instalación (variable de entorno), o null.
 * Solo para desarrollo y pruebas: en una instalación con varios centros la URL
 * sale de la organización.
 */
export function resolveModuleBaseUrl(
  module: OsModule,
  env: Record<string, string | undefined>,
  rules: ModuleUrlRules = {},
): URL | null {
  return parseModuleBaseUrl(env[MODULE_URL_ENV[module]], rules)
}

export function summaryUrl(base: URL): string {
  const path = base.pathname.replace(/\/+$/, '')
  return new URL(`${path}/api/os/summary`, base).toString()
}
