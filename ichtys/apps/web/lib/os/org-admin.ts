import { z } from 'zod'
import { OS_MODULES, moduleBaseUrlText, parseModuleBaseUrl, type ModuleUrlRules } from '@ichtys/integrations'
import { resolveTimeZone } from '../agenda/agenda-time'

/**
 * Lo que un administrador puede cambiar de su centro. La organización no va en
 * el cuerpo: sale del token. No hay forma de mandar credenciales por acá.
 */
export const orgConfigInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('module'), module: z.enum(OS_MODULES), baseUrl: z.string().max(300), enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal('time_zone'), timeZone: z.string().max(64) }).strict(),
])
export type OrgConfigInput = z.infer<typeof orgConfigInputSchema>

export type ModuleInputError = 'url_required' | 'url_invalid'

/**
 * Un módulo encendido necesita URL; una URL que no cumple las reglas no se
 * guarda ni apagada. Se guarda normalizada: origen y ruta, nada más.
 */
export function checkModuleInput(
  input: { baseUrl: string; enabled: boolean },
  rules: ModuleUrlRules = {},
): { ok: true; baseUrl: string | null } | { ok: false; error: ModuleInputError } {
  const raw = input.baseUrl.trim()
  if (!raw) return input.enabled ? { ok: false, error: 'url_required' } : { ok: true, baseUrl: null }
  const url = parseModuleBaseUrl(raw, rules)
  return url ? { ok: true, baseUrl: moduleBaseUrlText(url) } : { ok: false, error: 'url_invalid' }
}

/** Vacía = volver a la zona de la instalación. */
export function checkTimeZoneInput(value: string): { ok: true; timeZone: string | null } | { ok: false; error: 'time_zone_invalid' } {
  const zone = value.trim()
  if (!zone) return { ok: true, timeZone: null }
  return resolveTimeZone(zone, '') === zone ? { ok: true, timeZone: zone } : { ok: false, error: 'time_zone_invalid' }
}

/** Para la auditoría: el servidor, nunca la ruta ni los parámetros de la URL. */
export function urlHost(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
