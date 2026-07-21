import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { checkAndRecoverStuckDocs } from '@ichtys/ingestion'

// DB access → nodejs runtime, nunca edge. force-dynamic para que no se cachee.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cron de recuperación de stuck docs (SD).
 *
 * Marca como 'error' (errorCode 'stuck_timeout') las document versions atascadas
 * en status='processing' por más de STUCK_DOCS_THRESHOLD_MINUTES (default 60),
 * dejándolas reprocesables desde la UI. Idempotente.
 *
 * Auth: header `Authorization: Bearer ${CRON_SECRET}`.
 *   - Vercel Cron lo inyecta automáticamente si CRON_SECRET está en el proyecto.
 *   - GitHub Actions lo manda explícito con el mismo secret.
 */
/** Comparación constant-time: no filtra por timing cuántos caracteres coinciden. */
function secretMatches(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)
  if (receivedBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(receivedBuffer, expectedBuffer)
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!process.env.CRON_SECRET || !secretMatches(auth, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const thresholdMinutes = Number(process.env.STUCK_DOCS_THRESHOLD_MINUTES ?? 60)

  try {
    const recovered = await checkAndRecoverStuckDocs(thresholdMinutes)
    return NextResponse.json({ ok: true, thresholdMinutes, recovered })
  } catch (err) {
    console.error('[cron/recover-stuck-docs]', err)
    return NextResponse.json({ ok: false, error: 'recovery failed' }, { status: 500 })
  }
}
