import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const envPath = join(process.cwd(), '.env.local')

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

export const hasIntegrationEnv =
  Boolean(process.env.DATABASE_URL?.trim()) &&
  Boolean(process.env.PHI_ENCRYPTION_KEY?.trim())

/** IDs demo — deben coincidir con scripts/lib/mock-demo-constants.ts */
export const DEMO_ORG_ID = '1f3cde8b-be2a-4adf-9bbc-a2cf54163920'
export const DEMO_STUDY_ID = '508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6'
