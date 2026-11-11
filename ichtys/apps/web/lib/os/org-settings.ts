import { cache } from 'react'
import { db, eq, organizations } from '@ichtys/db'
import { resolveTimeZone, siteTimeZone } from '../agenda/agenda-time'

/**
 * Zona horaria del centro: `own` es la que cargó la organización (o null) y
 * `effective` la que se usa: la propia si es válida, y si no la de la
 * instalación. Nunca lanza: una Agenda con la hora de la instalación es mejor
 * que una Agenda caída.
 */
export const loadOrgTimeZoneSetting = cache(async (orgId: string): Promise<{ own: string | null; effective: string }> => {
  const fallback = siteTimeZone()
  try {
    const [row] = await db.select({ osSettings: organizations.osSettings }).from(organizations).where(eq(organizations.id, orgId)).limit(1)
    const own = resolveTimeZone(row?.osSettings?.timeZone, '') || null
    return { own, effective: own ?? fallback }
  } catch {
    console.error('[os] no se pudo leer la zona horaria de la organización')
    return { own: null, effective: fallback }
  }
})

export async function loadOrgTimeZone(orgId: string): Promise<string> {
  return (await loadOrgTimeZoneSetting(orgId)).effective
}
