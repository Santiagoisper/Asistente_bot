/**
 * IQ — Installation Qualification smoke (Etapa 2).
 * Verifica env requerido para PHI y tablas Fase 1 en Neon.
 *
 * Uso: pnpm iq:check
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '../apps/web/.env.local')

for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx)
  const value = trimmed.slice(eqIdx + 1)
  if (!process.env[key]) process.env[key] = value
}

type Check = { name: string; ok: boolean; detail?: string }
const checks: Check[] = []

function pass(name: string, detail?: string): void {
  checks.push({ name, ok: true, detail })
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`)
}

function fail(name: string, detail?: string): void {
  checks.push({ name, ok: false, detail })
  console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main(): Promise<void> {
  console.log('\n=== IQ Check — env + schema ===\n')

  if (process.env.PHI_ENCRYPTION_KEY?.trim()) {
    pass('PHI_ENCRYPTION_KEY', 'present')
  } else {
    fail('PHI_ENCRYPTION_KEY', 'missing')
  }

  const dbUrl = process.env.DATABASE_URL?.trim()
  if (dbUrl) {
    pass('DATABASE_URL', 'present')
  } else {
    fail('DATABASE_URL', 'missing')
    process.exit(1)
  }

  if (process.env.CLERK_SECRET_KEY?.startsWith('sk_')) {
    pass('CLERK_SECRET_KEY', 'present')
  } else {
    fail('CLERK_SECRET_KEY', 'missing or invalid')
  }

  const { db, sql } = await import('../packages/db/index')

  const requiredTables = [
    'subjects',
    'clinical_evolutions',
    'patient_profiles',
    'screening_assessments',
    'audit_logs',
    'organizations',
  ]

  const found = await db.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'subjects', 'clinical_evolutions', 'patient_profiles',
        'screening_assessments', 'audit_logs', 'organizations'
      )
  `)

  const foundSet = new Set(
    (found.rows ?? found).map((r: { table_name: string }) => r.table_name),
  )

  for (const table of requiredTables) {
    if (foundSet.has(table)) pass(`Schema table ${table}`)
    else fail(`Schema table ${table}`, 'missing — run db:migrate')
  }

  const orgRows = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count FROM organizations
  `)
  const orgCount = Number((orgRows.rows ?? orgRows)[0]?.count ?? 0)
  if (orgCount >= 1) pass('Organizations seeded', `${orgCount} org(s)`)
  else fail('Organizations seeded', '0 rows')

  const ragCol = await db.execute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'rag_config'
  `)
  const ragRows = ragCol.rows ?? ragCol
  if (ragRows.length > 0) pass('Migration rag_config', 'organizations.rag_config')
  else fail('Migration rag_config', 'column missing')

  const failed = checks.filter((c) => !c.ok)
  console.log(`\n=== IQ: ${checks.length - failed.length}/${checks.length} OK ===\n`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
