/**
 * Gate unificado de validación producto (CSV Etapa 2 — Fase 2).
 *
 * Orquesta typecheck → tests → OQ → leakage → IQ → E2E producto.
 *
 * Uso:
 *   pnpm validate:product          # gate completo (requiere .env.local + Neon)
 *   pnpm validate:product:ci       # solo checks sin DB (CI / pre-commit rápido)
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const envPath = join(ROOT, 'apps/web/.env.local')

const ciMode = process.argv.includes('--ci')

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const value = trimmed.slice(eqIdx + 1)
    if (!process.env[key]) process.env[key] = value
  }
}

interface Step {
  id: string
  label: string
  command: string
  dbRequired?: boolean
}

const STEPS: Step[] = [
  { id: 'typecheck', label: 'Typecheck', command: 'pnpm typecheck' },
  { id: 'test', label: 'Unit / integration tests', command: 'pnpm test' },
  { id: 'test:oq', label: 'OQ tests (módulo clínico)', command: 'pnpm test:oq' },
  { id: 'test:integration', label: 'Integration tests PHI (DB)', command: 'pnpm test:integration', dbRequired: true },
  { id: 'test:leakage', label: 'Tenant leakage tests', command: 'pnpm test:leakage' },
  { id: 'iq:check', label: 'IQ — env + schema', command: 'pnpm iq:check', dbRequired: true },
  { id: 'e2e:product', label: 'E2E product loop', command: 'pnpm e2e:product', dbRequired: true },
]

type StepResult = { id: string; label: string; ok: boolean; ms: number; skipped?: boolean; detail?: string }

function runStep(step: Step): StepResult {
  const start = Date.now()
  if (ciMode && step.dbRequired) {
    return { id: step.id, label: step.label, ok: true, ms: 0, skipped: true, detail: 'skip --ci' }
  }
  if (step.dbRequired && !process.env.DATABASE_URL?.trim()) {
    return {
      id: step.id,
      label: step.label,
      ok: true,
      ms: 0,
      skipped: true,
      detail: 'skip — DATABASE_URL not set',
    }
  }

  console.log(`\n=== ${step.label} (${step.id}) ===\n`)
  try {
    execSync(step.command, { cwd: ROOT, stdio: 'inherit', env: process.env })
    return { id: step.id, label: step.label, ok: true, ms: Date.now() - start }
  } catch {
    return { id: step.id, label: step.label, ok: false, ms: Date.now() - start }
  }
}

async function main(): Promise<void> {
  console.log('\n=== Validate Product — CSV Etapa 2 ===')
  console.log(`Modo: ${ciMode ? 'CI (sin DB)' : 'completo'}\n`)

  const results: StepResult[] = []
  for (const step of STEPS) {
    const result = runStep(step)
    results.push(result)
    if (!result.ok) break
  }

  console.log('\n=== Resumen validate:product ===\n')
  for (const r of results) {
    const icon = r.skipped ? '○' : r.ok ? '✓' : '✗'
    const suffix = r.skipped ? ` (${r.detail})` : r.ok ? ` (${(r.ms / 1000).toFixed(1)}s)` : ' — FAILED'
    console.log(`${icon} ${r.label}${suffix}`)
  }

  const executed = results.filter((r) => !r.skipped)
  const failed = executed.filter((r) => !r.ok)
  const skipped = results.filter((r) => r.skipped)

  console.log(
    `\nTotal: ${executed.length - failed.length}/${executed.length} OK` +
      (skipped.length > 0 ? `, ${skipped.length} skipped` : '') +
      '\n',
  )

  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
