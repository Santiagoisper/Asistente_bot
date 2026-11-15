import { studySpecSchema } from '@ichtys/ingestion/study-spec'
import { getLatestStudySpec } from '@ichtys/ingestion/spec-store'
import { protocolVisitLabels } from './visit-labels'

function labelsOf(spec: unknown): string[] {
  const parsed = studySpecSchema.safeParse(spec)
  return parsed.success ? protocolVisitLabels(parsed.data.visits) : []
}

/**
 * Los rótulos de visita que valen para el estudio, para comprobar en el servidor lo que manda la
 * pantalla. Junta el protocolo aprobado y el último borrador: la guía de dictado muestra el cronograma
 * de cualquiera de los dos (decisión del 12/11/2026). Cada cronograma arma sus rótulos por separado,
 * igual que la pantalla.
 */
export async function loadStudyVisitLabels(scope: { orgId: string; studyId: string }): Promise<string[]> {
  const [approved, latest] = await Promise.all([
    getLatestStudySpec({ ...scope, approvedOnly: true }),
    getLatestStudySpec({ ...scope, approvedOnly: false }),
  ])
  return [...new Set([...labelsOf(approved?.spec), ...labelsOf(latest?.spec)])]
}
