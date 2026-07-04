/**
 * Obtiene cookie mínima para eval runner vía Clerk Backend API.
 * Requiere CLERK_SECRET_KEY y usuario con sesión activa en la org demo.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_CLERK_ORG_ID } from './lib/mock-demo-constants'

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

async function main(): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY ?? ''
  const userId = process.env.EVAL_USER_ID ?? 'user_3EmgnPBW1ZSD46DJIjZa4Oiad6e'

  if (!secretKey.startsWith('sk_')) {
    console.error('CLERK_SECRET_KEY missing')
    process.exit(1)
  }

  const sessRes = await fetch(
    `https://api.clerk.com/v1/sessions?user_id=${userId}&status=active&limit=5`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  )
  if (!sessRes.ok) {
    console.error('Sessions API failed:', sessRes.status, await sessRes.text())
    process.exit(1)
  }
  const sessions = (await sessRes.json()) as Array<{ id: string; status: string }>
  const active = sessions.filter((s) => s.status === 'active')
  if (!active.length) {
    console.error('No active Clerk sessions. Sign in at localhost:3003 first.')
    process.exit(1)
  }

  const sessionId = active[0]!.id
  const tokenRes = await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  if (!tokenRes.ok) {
    console.error('Token API failed:', tokenRes.status, await tokenRes.text())
    process.exit(1)
  }
  const { jwt } = (await tokenRes.json()) as { jwt: string }

  function decodePayload(jwtToken: string): Record<string, unknown> {
    const b64 = jwtToken.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>
  }

  const payload = decodePayload(jwt)
  const orgClaim = payload['o'] as Record<string, unknown> | undefined
  console.log('sessionId:', sessionId)
  console.log('org in JWT:', orgClaim?.['id'] ?? 'MISSING')
  console.log('userId:', payload['sub'])

  const cookie = [
    `__session=${jwt}`,
    `clerk_active_context=${sessionId}:${DEMO_CLERK_ORG_ID}`,
    `__clerk_db_jwt=eval-placeholder`,
    `__refresh_eval=placeholder`,
  ].join('; ')

  console.log('\nEVAL_AUTH_COOKIE=' + cookie)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
