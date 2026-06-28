/**
 * fix-stuck-docs.ts — recovery script para document versions atascadas.
 *
 * Problema: docs históricos pueden quedar atascados en status='processing'
 * si el pipeline falló silenciosamente (crash del worker, timeout de Lambda,
 * error de red durante la ingestion, blobUrl null pre-blob-fix).
 *
 * Solución: marcar como 'error' con errorCode='stuck_timeout' todos los docs
 * en status='processing' con updatedAt más de STUCK_THRESHOLD_MINUTES atrás.
 * Eso los hace reprocesables desde la UI ("Forzar reprocesar").
 *
 * SEGURO de correr múltiples veces: idempotente.
 * NO afecta docs en 'ready', 'error', o 'processing' reciente.
 *
 * Uso:
 *   npx tsx scripts/fix-stuck-docs.ts [--threshold-minutes 60] [--dry-run]
 *
 * Variables de entorno requeridas: DATABASE_URL (Neon / Postgres).
 */

import { and, eq, lt, sql } from 'drizzle-orm'
import { db, documentVersions } from '@ichtys/db'

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const STUCK_THRESHOLD_MINUTES = (() => {
  const idx = process.argv.indexOf('--threshold-minutes')
  if (idx !== -1 && process.argv[idx + 1]) {
    const v = parseInt(process.argv[idx + 1], 10)
    if (!isNaN(v) && v > 0) return v
  }
  return 60
})()

const DRY_RUN = process.argv.includes('--dry-run')

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000)

  console.log(`[fix-stuck-docs] threshold=${STUCK_THRESHOLD_MINUTES}min cutoff=${cutoff.toISOString()} dry_run=${DRY_RUN}`)

  // Find stuck docs
  const stuck = await db
    .select({
      id: documentVersions.id,
      documentId: documentVersions.documentId,
      organizationId: documentVersions.organizationId,
      studyId: documentVersions.studyId,
      updatedAt: documentVersions.updatedAt,
    })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.status, 'processing'),
        lt(documentVersions.updatedAt, cutoff),
      ),
    )

  if (stuck.length === 0) {
    console.log('[fix-stuck-docs] ✓ No stuck documents found.')
    return
  }

  console.log(`[fix-stuck-docs] Found ${stuck.length} stuck document version(s):`)
  for (const d of stuck) {
    console.log(`  → id=${d.id} documentId=${d.documentId} orgId=${d.organizationId} studyId=${d.studyId} updatedAt=${d.updatedAt?.toISOString()}`)
  }

  if (DRY_RUN) {
    console.log('[fix-stuck-docs] DRY RUN — no changes written.')
    return
  }

  // Batch update to 'error' with stuck_timeout code
  const updated = await db
    .update(documentVersions)
    .set({
      status: 'error',
      errorMessage: 'stuck_timeout',
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(documentVersions.status, 'processing'),
        lt(documentVersions.updatedAt, cutoff),
      ),
    )
    .returning({ id: documentVersions.id })

  console.log(`[fix-stuck-docs] ✓ Marked ${updated.length} document version(s) as error/stuck_timeout.`)
  console.log('[fix-stuck-docs] These are now reprocesable via "Forzar reprocesar" in the UI.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[fix-stuck-docs] FATAL:', err)
    process.exit(1)
  })
