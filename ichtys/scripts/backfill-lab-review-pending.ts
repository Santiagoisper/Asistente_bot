/**
 * Backfill de la marca `lab_review_pending` (migración 0011).
 *
 * Recorre `patient_profiles`, descifra cada perfil y fija la marca según haya
 * o no una revisión de laboratorio pendiente. Idempotente: correrlo dos veces
 * deja el mismo resultado. No imprime contenido clínico, solo conteos.
 *
 * Uso:
 *   npx tsx@4.19.2 scripts/backfill-lab-review-pending.ts            (simulación)
 *   npx tsx@4.19.2 scripts/backfill-lab-review-pending.ts --apply    (escribe)
 *
 * Requiere DATABASE_URL y PHI_ENCRYPTION_KEY (se leen de apps/web/.env.local
 * si no están en el entorno). Aplicar la 0011 antes de correrlo.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '../apps/web/.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    if (!process.env[key]) process.env[key] = trimmed.slice(eqIdx + 1)
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const { db, eq, patientProfiles } = await import('../packages/db/index')
  const { parsePatientProfile } = await import('../packages/clinical/index')
  const { decryptProfileJson } = await import('../apps/web/lib/subjects/phi-fields')
  const { labReviewMarker } = await import('../apps/web/lib/subjects/lab-review-marker')

  const rows = await db
    .select({
      id: patientProfiles.id,
      profileEncrypted: patientProfiles.profileEncrypted,
      labReviewPending: patientProfiles.labReviewPending,
      labReviewPendingSince: patientProfiles.labReviewPendingSince,
    })
    .from(patientProfiles)

  let pending = 0
  let changed = 0
  let unreadable = 0

  for (const row of rows) {
    let marker
    try {
      marker = labReviewMarker(parsePatientProfile(decryptProfileJson(row.profileEncrypted)))
    } catch {
      // Perfil que no descifra o no valida: se cuenta y se deja como está.
      unreadable += 1
      continue
    }
    if (marker.labReviewPending) pending += 1

    const sameFlag = row.labReviewPending === marker.labReviewPending
    const sameSince =
      (row.labReviewPendingSince?.getTime() ?? null) === (marker.labReviewPendingSince?.getTime() ?? null)
    if (sameFlag && sameSince) continue

    changed += 1
    if (apply) {
      await db.update(patientProfiles).set(marker).where(eq(patientProfiles.id, row.id))
    }
  }

  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      profiles: rows.length,
      pending,
      changed,
      unreadable,
    }),
  )
  if (unreadable > 0) process.exitCode = 2
}

main().catch((err: unknown) => {
  console.error('[backfill-lab-review-pending] falló:', err instanceof Error ? err.name : 'error')
  process.exitCode = 1
})
