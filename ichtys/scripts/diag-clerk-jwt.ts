/**
 * diag-clerk-jwt.ts — diagnóstico de JWT de Clerk para evals
 *
 * Prueba el Backend API de Clerk y reporta si el JWT generado incluye
 * el claim `o.id` (org activa). Determina si el BAPI puede usarse para
 * el eval runner o si hace falta otro mecanismo.
 *
 * Uso:
 *   CLERK_SECRET_KEY=sk_test_... \
 *   EVAL_AUTH_COOKIE="__session=eyJ...; __clerk_db_jwt=dvb_...; __refresh_Kc0H-txM=..." \
 *   pnpm tsx scripts/diag-clerk-jwt.ts
 *
 * NO lee .env.local automáticamente — pasá las vars explícitamente.
 * NO loguea la cookie ni el JWT completo. Solo loguea el payload decodificado (no secreto).
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCookies(cookieStr: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of cookieStr.split(';')) {
    const eq = part.trim().indexOf('=')
    if (eq > 0) {
      result[part.trim().slice(0, eq).trim()] = part.trim().slice(eq + 1).trim()
    }
  }
  return result
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT structure')
  const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as Record<string, unknown>
}

function secondsUntilExpiry(jwt: string): number {
  try {
    const payload = decodeJwtPayload(jwt)
    const exp = payload['exp']
    if (typeof exp !== 'number') return 0
    return Math.max(0, exp - Math.floor(Date.now() / 1000))
  } catch {
    return 0
  }
}

function redactJwt(jwt: string): string {
  const parts = jwt.split('.')
  if (parts.length !== 3) return '[invalid-jwt]'
  return `${parts[0]!.slice(0, 10)}...[payload-redacted]...[sig-redacted]`
}

// ---------------------------------------------------------------------------
// BAPI call
// ---------------------------------------------------------------------------

async function callBapi(sessionId: string, secretKey: string): Promise<Record<string, unknown>> {
  const url = `https://api.clerk.com/v1/sessions/${sessionId}/tokens`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
  })
  const rawBody = await resp.text()
  if (!resp.ok) {
    throw new Error(`BAPI ${resp.status}: ${rawBody.slice(0, 300)}`)
  }
  return JSON.parse(rawBody) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// FAPI call (for comparison)
// ---------------------------------------------------------------------------

async function callFapi(
  clerkDomain: string,
  sessionId: string,
  cookieHeader: string,
  appOrigin: string,
): Promise<Record<string, unknown> | { error: string }> {
  const url = `https://${clerkDomain}/v1/client/sessions/${sessionId}/tokens`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
      Origin: appOrigin,
      Referer: appOrigin + '/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  })
  const rawBody = await resp.text()
  if (!resp.ok) {
    return { error: `FAPI ${resp.status}: ${rawBody.slice(0, 300)}` }
  }
  return JSON.parse(rawBody) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const secretKey = process.env['CLERK_SECRET_KEY'] ?? ''
const authCookie = process.env['EVAL_AUTH_COOKIE'] ?? ''
const appOrigin = process.env['EVAL_BASE_URL'] ?? 'http://localhost:3000'

if (!secretKey) {
  console.error('[diag] ERROR: CLERK_SECRET_KEY is required')
  process.exit(1)
}
if (!authCookie) {
  console.error('[diag] ERROR: EVAL_AUTH_COOKIE is required')
  process.exit(1)
}

const cookies = parseCookies(authCookie)

// Detect all cookie variants
const sessionJwt = cookies['__session']
const dbJwt = cookies['__clerk_db_jwt']

// Detect suffixed variants (e.g., __session_Kc0H-txM, __clerk_db_jwt_Kc0H-txM)
const suffixedSession = Object.entries(cookies).find(
  ([k]) => k.startsWith('__session_') && !k.startsWith('__session_uat'),
)?.[1]
const suffixedDbJwt = Object.entries(cookies).find(([k]) => k.startsWith('__clerk_db_jwt_'))?.[1]
const refreshEntry = Object.entries(cookies).find(([k]) => k.startsWith('__refresh_'))
const clerkActiveCtx = cookies['clerk_active_context']

console.log('\n[diag] ═══════════════════════════════════════════════════')
console.log('[diag] CLERK JWT DIAGNOSTICS')
console.log('[diag] ═══════════════════════════════════════════════════')

// 1. Analyze initial cookie
console.log('\n[diag] 1. COOKIE ANALYSIS')
console.log(`  __session present:          ${!!sessionJwt}`)
console.log(`  __session TTL:              ${sessionJwt ? secondsUntilExpiry(sessionJwt) + 's' : 'N/A'}`)
console.log(`  __session_* (suffixed):     ${!!suffixedSession}`)
console.log(`  __session_* TTL:            ${suffixedSession ? secondsUntilExpiry(suffixedSession) + 's' : 'N/A'}`)
console.log(`  __clerk_db_jwt present:     ${!!dbJwt}`)
console.log(`  __clerk_db_jwt_* (suffixed):${!!suffixedDbJwt}`)
console.log(`  __refresh_* present:        ${!!refreshEntry?.[1]} (key=${refreshEntry?.[0] ?? 'none'})`)
console.log(`  clerk_active_context:       ${clerkActiveCtx ?? 'none'}`)

if (sessionJwt) {
  const payload = decodeJwtPayload(sessionJwt)
  const orgClaim = payload['o'] as Record<string, unknown> | undefined
  console.log(`\n[diag] 2. INITIAL __session JWT CLAIMS`)
  console.log(`  sub (userId):     ${payload['sub']}`)
  console.log(`  sid (sessionId):  ${payload['sid']}`)
  console.log(`  iss:              ${payload['iss']}`)
  console.log(`  o.id (orgId):     ${orgClaim?.['id'] ?? 'MISSING'}`)
  console.log(`  o.rol (orgRole):  ${orgClaim?.['rol'] ?? 'MISSING'}`)
  console.log(`  o.slg (orgSlug):  ${orgClaim?.['slg'] ?? 'MISSING'}`)
  console.log(`  JWT (redacted):   ${redactJwt(sessionJwt)}`)
}

const sid = sessionJwt ? (decodeJwtPayload(sessionJwt)['sid'] as string) : null
const issuer = sessionJwt ? (decodeJwtPayload(sessionJwt)['iss'] as string) : null
const clerkDomain = issuer ? new URL(issuer).host : null

if (!sid || !clerkDomain) {
  console.error('\n[diag] ERROR: Cannot extract sessionId or clerkDomain from __session JWT')
  process.exit(1)
}

console.log(`\n  sessionId:        ${sid}`)
console.log(`  clerkDomain:      ${clerkDomain}`)

// 3. Test Backend API (BAPI)
console.log('\n[diag] 3. BACKEND API (BAPI) — POST /v1/sessions/{sessionId}/tokens')
try {
  const bapiResult = await callBapi(sid, secretKey)
  const bapiJwt = bapiResult['jwt'] as string | undefined
  if (!bapiJwt) {
    console.log('  Result: ERROR — no jwt in response')
    console.log(`  Response shape: ${Object.keys(bapiResult).join(', ')}`)
  } else {
    const bapiPayload = decodeJwtPayload(bapiJwt)
    const bapiOrg = bapiPayload['o'] as Record<string, unknown> | undefined
    console.log(`  Result:           OK`)
    console.log(`  JWT TTL:          ${secondsUntilExpiry(bapiJwt)}s`)
    console.log(`  o.id (orgId):     ${bapiOrg?.['id'] ?? 'MISSING ← THIS CAUSES 403'}`)
    console.log(`  o.rol (orgRole):  ${bapiOrg?.['rol'] ?? 'MISSING'}`)
    console.log(`  sub (userId):     ${bapiPayload['sub']}`)
    console.log(`  JWT (redacted):   ${redactJwt(bapiJwt)}`)
    if (!bapiOrg?.['id']) {
      console.log('\n  DIAGNOSIS: BAPI JWT lacks org claims → validateStudyAccess returns 403')
      console.log('  Cause: Clerk Backend API generates tokens WITHOUT active org context')
      console.log('  Fix needed: use FAPI, or find another way to include org in JWT')
    } else {
      console.log('\n  DIAGNOSIS: BAPI JWT HAS org claims → should work for eval runner')
      console.log('  Recommendation: revert runner to use BAPI token generation')
    }
  }
} catch (err) {
  console.log(`  Result: ERROR — ${err instanceof Error ? err.message : String(err)}`)
}

// 4. Test FAPI (all cookie variants)
console.log('\n[diag] 4. FRONTEND API (FAPI) — POST /v1/client/sessions/{sessionId}/tokens')

// Build cookie header with ALL variants
const allCookieParts: string[] = []
if (dbJwt) allCookieParts.push(`__clerk_db_jwt=${dbJwt}`)
if (suffixedDbJwt) {
  const suffixedKey = Object.keys(cookies).find((k) => k.startsWith('__clerk_db_jwt_'))
  if (suffixedKey) allCookieParts.push(`${suffixedKey}=${suffixedDbJwt}`)
}
if (cookies['__client_uat']) allCookieParts.push(`__client_uat=${cookies['__client_uat']}`)
const suffixedClientUat = Object.entries(cookies).find(([k]) => k.startsWith('__client_uat_'))
if (suffixedClientUat) allCookieParts.push(`${suffixedClientUat[0]}=${suffixedClientUat[1]}`)
if (refreshEntry) allCookieParts.push(`${refreshEntry[0]}=${refreshEntry[1]}`)
if (clerkActiveCtx) allCookieParts.push(`clerk_active_context=${clerkActiveCtx}`)

const fapiCookieHeader = allCookieParts.join('; ')
console.log(`  Sending cookies: ${allCookieParts.map((p) => p.split('=')[0]).join(', ')}`)

const fapiResult = await callFapi(clerkDomain, sid, fapiCookieHeader, appOrigin)

if ('error' in fapiResult) {
  console.log(`  Result: ERROR — ${fapiResult.error}`)
  if (fapiResult.error.includes('Browser unauthenticated')) {
    console.log('  DIAGNOSIS: FAPI rejects Node.js requests — dev-browser protection active')
    console.log('  This confirms FAPI cannot be used from server-side eval runner')
  }
} else {
  const fapiJwt = fapiResult['jwt'] as string | undefined
  if (!fapiJwt) {
    console.log(`  Result: ERROR — no jwt in response: ${Object.keys(fapiResult).join(', ')}`)
  } else {
    const fapiPayload = decodeJwtPayload(fapiJwt)
    const fapiOrg = fapiPayload['o'] as Record<string, unknown> | undefined
    console.log(`  Result:           OK`)
    console.log(`  JWT TTL:          ${secondsUntilExpiry(fapiJwt)}s`)
    console.log(`  o.id (orgId):     ${fapiOrg?.['id'] ?? 'MISSING'}`)
    console.log(`  o.rol (orgRole):  ${fapiOrg?.['rol'] ?? 'MISSING'}`)
  }
}

// 5. Summary
console.log('\n[diag] 5. SUMMARY & RECOMMENDATION')
if (sessionJwt && secondsUntilExpiry(sessionJwt) > 0) {
  console.log('  Initial __session JWT is still VALID')
  const orgClaim = (decodeJwtPayload(sessionJwt)['o'] as Record<string, unknown> | undefined)
  if (orgClaim?.['id']) {
    console.log('  Initial JWT has org context — usable for first request')
    console.log('  ISSUE: JWT will expire during 12-case run (~240s) and refresh is blocked')
  }
}
console.log('\n[diag] ═══════════════════════════════════════════════════\n')
