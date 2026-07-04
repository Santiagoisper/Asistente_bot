/**
 * Verifica PHI en prod: crea sujeto TEST-PHI via API autenticada y lo borra en Neon.
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

const PROD_BASE = 'https://asistente-bot-five.vercel.app'
const STUDY_ID = '508fa9c9-dbb9-49aa-abd5-7f7fe968bbc6'

async function getJwt(): Promise<string> {
  const secretKey = process.env.CLERK_SECRET_KEY ?? ''
  const userId = process.env.EVAL_USER_ID ?? 'user_3EmgnPBW1ZSD46DJIjZa4Oiad6e'
  const sessRes = await fetch(
    `https://api.clerk.com/v1/sessions?user_id=${userId}&status=active&limit=5`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  )
  if (!sessRes.ok) throw new Error(`Sessions API ${sessRes.status}`)
  const sessions = (await sessRes.json()) as Array<{ id: string; status: string }>
  const active = sessions.filter((s) => s.status === 'active')
  if (!active.length) throw new Error('No active Clerk session')
  const tokenRes = await fetch(`https://api.clerk.com/v1/sessions/${active[0]!.id}/tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!tokenRes.ok) throw new Error(`Token API ${tokenRes.status}`)
  const { jwt } = (await tokenRes.json()) as { jwt: string }
  return jwt
}

async function main(): Promise<void> {
  const jwt = await getJwt()
  const code = `TEST-PHI-${Date.now().toString(36).toUpperCase()}`
  const url = `${PROD_BASE}/api/studies/${STUDY_ID}/subjects`

  const createRes = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subjectCode: code }),
  })

  const createText = await createRes.text()
  if (!createRes.ok) {
    console.error('FAIL create:', createRes.status, createText.slice(0, 500))
    process.exit(1)
  }

  const created = JSON.parse(createText) as { id: string; subjectCode: string }
  console.log('OK create:', createRes.status, created.id, created.subjectCode)

  const { db, eq } = await import('../packages/db/index')
  const { subjects } = await import('../packages/db/schema/index')
  await db.delete(subjects).where(eq(subjects.id, created.id))
  console.log('OK cleanup: deleted', created.id)
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
