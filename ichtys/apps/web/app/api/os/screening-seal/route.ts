import { auth } from '@clerk/nextjs/server'
import { canAdministerOrg, normalizeRole } from '@ichtys/auth'
import { loadAccessSubject } from '@ichtys/auth/access-subject'
import { allows } from '@ichtys/auth/functions'
import { db, eq, organizations } from '@ichtys/db'
import { z } from 'zod'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../lib/api/body-limit'
import { isScreeningSealEnabled } from '../../../../lib/flags'
import { databaseTargetOf } from '../../../../lib/subjects/screening-seal'
import { runOrgSeal } from '../../../../lib/subjects/screening-seal-run'
import { orgSealStore } from '../../../../lib/subjects/screening-seal-store'

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
 * - Solo quien administra la organización, y solo para **su** organización: sale del token
 *   de la sesión, nunca del pedido.
 * - En producción no existe salvo que ALPHI_SEAL_SCREENING valga "on".
 * - Ninguna respuesta lleva contenido clínico: cantidades y a qué base apunta el entorno
 *   (`host/base`, sin usuario ni contraseña).
 */
async function authorize(): Promise<{ orgId: string; userId: string } | Response> {
  if (!isScreeningSealEnabled()) return new Response('Not Found', { status: 404 })
  const { userId, orgId: clerkOrgId, orgRole } = await auth()
  if (!userId || !clerkOrgId) return new Response('Unauthorized', { status: 401 })
  const org = await db.query.organizations.findFirst({ where: eq(organizations.clerkOrgId, clerkOrgId) })
  if (!org) return new Response('Forbidden', { status: 403 })
  const access = await loadAccessSubject({ org, userId, role: normalizeRole(orgRole) })
  if (!allows(access, 'org.settings', canAdministerOrg)) return new Response('Forbidden', { status: 403 })
  return { orgId: org.id, userId }
}

/** GET — cuánto hay para sellar en la organización. No escribe ni lee contenido: cuenta. */
export async function GET(): Promise<Response> {
  try {
    const who = await authorize()
    if (who instanceof Response) return who
    const store = orgSealStore(who.orgId)
    const [rows, plain, foreignEnvelope] = await Promise.all([store.countRows(), store.countPlain(), store.countForeign()])
    return Response.json({ rows, plain, foreignEnvelope, target: databaseTargetOf(process.env.DATABASE_URL) })
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
    const who = await authorize()
    if (who instanceof Response) return who

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

    const outcome = await runOrgSeal(orgSealStore(who.orgId), { orgId: who.orgId, userId: who.userId, batchSize: BATCH_SIZE, budgetMs: BUDGET_MS })
    if (outcome.status === 'done' || outcome.status === 'partial') return Response.json(outcome)
    return Response.json({ error: outcome.status }, { status: 409 })
  } catch (err) {
    // Sin contenido ni identificadores: el mensaje de un error de ida y vuelta nombra la fila.
    const roundTrip = err instanceof Error && err.name === 'ScreeningSealRoundTripError'
    return Response.json(roundTrip ? { error: 'seal_failed', reason: 'round_trip' } : { error: 'seal_failed' }, { status: 500 })
  }
}
