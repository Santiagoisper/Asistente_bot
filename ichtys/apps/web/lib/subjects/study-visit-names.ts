import { studySpecSchema } from '@ichtys/ingestion/study-spec'
import { getLatestStudySpec } from '@ichtys/ingestion/spec-store'

function visitNames(spec: unknown): string[] {
  const parsed = studySpecSchema.safeParse(spec)
  return parsed.success ? parsed.data.visits.map((visit) => visit.name) : []
}

/**
 * Los nombres de visita del estudio, para comprobar en el servidor lo que manda la pantalla. Junta el
 * protocolo aprobado y el último borrador: la guía de dictado muestra el cronograma de cualquiera de
 * los dos (decisión del 12/11/2026).
 */
export async function loadStudyVisitNames(scope: { orgId: string; studyId: string }): Promise<string[]> {
  const [approved, latest] = await Promise.all([
    getLatestStudySpec({ ...scope, approvedOnly: true }),
    getLatestStudySpec({ ...scope, approvedOnly: false }),
  ])
  return [...new Set([...visitNames(approved?.spec), ...visitNames(latest?.spec)])]
}
