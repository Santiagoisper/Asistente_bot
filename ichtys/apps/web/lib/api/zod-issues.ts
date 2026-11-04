import type { z } from 'zod'
import { MAX_ISSUES_IN_RESPONSE } from './limits'

/**
 * Acota lo que SALE en una respuesta de validación (vuelta 3, H7): el PATCH
 * de spec devolvía `parsed.error.issues` entero y con 120k sourcePages
 * inválidos la respuesta pesaba 18 MB — amplificación de 38× sin gastar
 * casi nada del lado del cliente.
 *
 * Devuelve a lo sumo MAX_ISSUES_IN_RESPONSE issues, cada uno SOLO con su
 * código y su ruta — nunca el mensaje ni el valor recibido (puede contener
 * texto del usuario), más un contador totalIssues para que el cliente sepa
 * que hubo más.
 */
export function zodIssuesForResponse(error: z.ZodError): {
  totalIssues: number
  issues: Array<{ path: string; code: string }>
} {
  return {
    totalIssues: error.issues.length,
    issues: error.issues
      .slice(0, MAX_ISSUES_IN_RESPONSE)
      .map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
  }
}
