import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../lib/api/body-limit'
import { screeningSealOperators } from '../../../../lib/flags'
import { databaseTargetOf } from '../../../../lib/subjects/screening-seal'
import { runSeal } from '../../../../lib/subjects/screening-seal-run'
import { orgSealStore, sealKeySamples, sealOverview } from '../../../../lib/subjects/screening-seal-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Filas por tanda; cada tanda es una transacción con su registro. */
const BATCH_SIZE = 200
/** Pasado este tiempo no se abre otra tanda: lo que falte queda para el pedido siguiente. */
const BUDGET_MS = 20_000

const sealInputSchema = z.object({ confirm: z.string().trim().min(1).max(300) })

/**
 * Ruta con fecha de baja (`SCREENING_SEAL_CLOSES_AT`): sella las evaluaciones de elegibilidad
 * que se guardaron en claro antes del cifrado (C3, docs/compliance/REGULATORY-BASELINE.md).
 *
 * - Es un trabajo de quien responde por el sistema, no de cada centro: solo los operadores de
 *   ALPHI_SEAL_OPERATORS. Para cualquier otra persona, administre lo que administre, la ruta
 *   no existe. Sin esa variable no existe en ningún entorno.
 * - Recorre todas las organizaciones; cada tanda es de una sola y deja su registro a nombre
 *   del operador.
 * - Ninguna respuesta lleva contenido clínico ni identificadores de organización: cantidades
 *   y a qué base apunta el entorno (`host/base`, sin usuario ni contraseña), que solo ve el
 *   operador.
 */
async function operatorId(): Promise<string | Response> {
  const operators = screeningSealOperators()
  if (operators.length === 0) return new Response('Not Found', { status: 404 })
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })
  if (!operators.includes(userId)) return new Response('Not Found', { status: 404 })
  return userId
}

/** GET — cuánto hay para sellar en todo el sistema. No escribe ni lee contenido: cuenta. */
export async function GET(): Promise<Response> {
  try {
    const operator = await operatorId()
    if (operator instanceof Response) return operator
    const overview = await sealOverview()
    const sum = (pick: (org: (typeof overview)[number]) => number) => overview.reduce((total, org) => total + pick(org), 0)
    return Response.json({
      organizations: overview.length,
      organizationsWithPlain: overview.filter((org) => org.plain > 0).length,
      rows: sum((org) => org.rows),
      plain: sum((org) => org.plain),
      foreignEnvelope: sum((org) => org.foreignEnvelope),
      target: databaseTargetOf(process.env.DATABASE_URL),
    })
  } catch {
    return Response.json({ error: 'seal_status_failed' }, { status: 500 })
  }
}

/**
 * POST — sella. El cuerpo confirma a qué base apunta el entorno (`confirm`, igual al `target`
 * que devuelve el GET): si no coincide, no se escribe nada. Se puede repetir.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const operator = await operatorId()
    if (operator instanceof Response) return operator

    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch (err) {
      if (err instanceof JsonBodyTooLargeError) return new Response('Payload Too Large', { status: 413 })
      return new Response('Bad Request', { status: 400 })
    }
    const parsed = sealInputSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'invalid_input' }, { status: 400 })

    const target = databaseTargetOf(process.env.DATABASE_URL)
    if (target === null || parsed.data.confirm !== target) return Response.json({ error: 'target_mismatch' }, { status: 409 })

    const outcome = await runSeal({ overview: sealOverview, keySamples: sealKeySamples, storeFor: orgSealStore }, { userId: operator, batchSize: BATCH_SIZE, budgetMs: BUDGET_MS })
    if (outcome.status === 'no_key') return Response.json({ error: 'no_key' }, { status: 409 })
    return Response.json(outcome)
  } catch (err) {
    // Sin contenido ni identificadores: el mensaje de un error de ida y vuelta nombra la fila.
    const roundTrip = err instanceof Error && err.name === 'ScreeningSealRoundTripError'
    return Response.json(roundTrip ? { error: 'seal_failed', reason: 'round_trip' } : { error: 'seal_failed' }, { status: 500 })
  }
}
