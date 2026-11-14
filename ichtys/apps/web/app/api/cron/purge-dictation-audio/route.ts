import { timingSafeEqual } from 'node:crypto'
import { db } from '@ichtys/db'
import { insertAuditLog } from '../../../../lib/audit/audited-write'
import { purgeExpiredDictationAudios, purgeExpiredUnassignedAudios } from '../../../../lib/dictation/audio-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function secretMatches(received: string, expected: string): boolean {
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Tarea diaria: borra el contenido de las grabaciones vencidas y deja constancia
 * (docs/decisions/consulta-dictada.md, D14). Auth: `Authorization: Bearer ${CRON_SECRET}`.
 * El borrado y su registro van en una transacción (R3).
 */
export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization') ?? ''
  if (!process.env.CRON_SECRET || !secretMatches(auth, `Bearer ${process.env.CRON_SECRET}`)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const now = new Date()
    const purged = await db.transaction(async (tx) => {
      const rows = await purgeExpiredDictationAudios(tx, now)
      for (const audio of rows) {
        await insertAuditLog(tx, {
          action: 'evolution.audio.purge',
          orgId: audio.organizationId,
          studyId: audio.studyId,
          userId: 'system:retention',
          resourceType: 'dictation_audio',
          resourceId: audio.id,
          metadata: { reason: 'expired' },
        })
      }
      // El depósito de grabaciones sin sujeto vence igual (D24).
      const unassigned = await purgeExpiredUnassignedAudios(tx, now)
      for (const audio of unassigned) {
        await insertAuditLog(tx, {
          action: 'evolution.audio.purge',
          orgId: audio.organizationId,
          studyId: audio.studyId,
          userId: 'system:retention',
          resourceType: 'unassigned_dictation_audio',
          resourceId: audio.id,
          metadata: { reason: 'expired' },
        })
      }
      return { subjects: rows.length, unassigned: unassigned.length }
    })
    return Response.json({ ok: true, purged: purged.subjects, purgedUnassigned: purged.unassigned })
  } catch {
    return Response.json({ ok: false, error: 'purge_failed' }, { status: 500 })
  }
}
