import { cache } from 'react'
import { db, eq, organizations } from '@ichtys/db'
import { resolveTimeZone, siteTimeZone } from '../agenda/agenda-time'

/**
 * Zona horaria del centro: la de la organización si tiene una válida, y si no
 * la de la instalación. Nunca lanza: una Agenda con la hora de la instalación
 * es mejor que una Agenda caída.
 */
export const loadOrgTimeZone = cache(async (orgId: string): Promise<string> => {
  const fallback = siteTimeZone()
  try {
    const [row] = await db.select({ osSettings: organizations.osSettings }).from(organizations).where(eq(organizations.id, orgId)).limit(1)
    return resolveTimeZone(row?.osSettings?.timeZone, fallback)
  } catch {
    console.error('[os] no se pudo leer la zona horaria de la organización')
    return fallback
  }
})
