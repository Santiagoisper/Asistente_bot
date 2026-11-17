import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../lib/api/body-limit'
import { runChatSeal } from '../../../../lib/chat/chat-seal'
import { chatSealKeySamples, chatSealOverview, orgChatSealStore } from '../../../../lib/chat/chat-seal-store'
import { screeningSealOperators } from '../../../../lib/flags'
import { databaseTargetOf, sealTargetAllowedHere } from '../../../../lib/subjects/screening-seal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Mensajes y conversaciones por tanda; cada tanda es una transacción con su registro. */
const BATCH_SIZE = 200
/** Pasado este tiempo no se abre otra tanda: lo que falte queda para el pedido siguiente. */
const BUDGET_MS = 20_000

const sealInputSchema = z.object({ confirm: z.string().trim().min(1).max(300) })

/**
 * Sellado del chat anterior al cifrado (decisión del 16/11/2026): preguntas, respuestas y
 * títulos que quedaron en claro pasan a su columna cifrada; las anotaciones viejas se vacían.
 *
 * Mismas reglas que `/api/os/screening-seal`, y la misma fecha de baja:
 * - Solo los operadores de ALPHI_SEAL_OPERATORS. Para cualquier otra persona la ruta no
 *   existe; sin esa variable no existe en ningún entorno.
 * - Recorre todas las organizaciones; cada tanda es de una sola y deja su registro.
 * - Ninguna respuesta lleva texto del chat ni identificadores de organización: cantidades y
 *   a qué base apunta el entorno (`host/base`, sin usuario ni contraseña).
 */
async function operatorId(): Promise<string | Response> {
  const operators = screeningSealOperators()
  if (operators.length === 0) return new Response('Not Found', { status: 404 })
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })
  if (!operators.includes(userId)) return new Response('Not Found', { status: 404 })
  return userId
}

/** GET — cuánto hay en claro en todo el sistema. No escribe ni lee contenido: cuenta. */
export async function GET(): Promise<Response> {
  try {
    const operator = await operatorId()
    if (operator instanceof Response) return operator
    const overview = await chatSealOverview()
    const sum = (pick: (org: (typeof overview)[number]) => number) => overview.reduce((total, org) => total + pick(org), 0)
    return Response.json({
      organizations: overview.length,
      organizationsWithPlain: overview.filter((org) => org.plainMessages + org.plainTitles + org.annotations > 0).length,
      messages: sum((org) => org.messages),
      plainMessages: sum((org) => org.plainMessages),
      plainTitles: sum((org) => org.plainTitles),
      annotations: sum((org) => org.annotations),
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
    // Fuera de producción solo contra una base de prueba conocida (ver sealTargetAllowedHere).
    if (!sealTargetAllowedHere(target, process.env.VERCEL_ENV)) return Response.json({ error: 'target_not_allowed_here' }, { status: 409 })

    const outcome = await runChatSeal(
      { overview: chatSealOverview, keySamples: chatSealKeySamples, storeFor: orgChatSealStore },
      { userId: operator, batchSize: BATCH_SIZE, budgetMs: BUDGET_MS },
    )
    if (outcome.status === 'no_key' || outcome.status === 'key_mismatch' || outcome.status === 'key_unverified') {
      return Response.json({ error: outcome.status }, { status: 409 })
    }
    return Response.json(outcome)
  } catch (err) {
    // Sin contenido ni identificadores: el mensaje de un error de ida y vuelta nombra la fila.
    const roundTrip = err instanceof Error && err.name === 'ChatSealRoundTripError'
    return Response.json(roundTrip ? { error: 'seal_failed', reason: 'round_trip' } : { error: 'seal_failed' }, { status: 500 })
  }
}
