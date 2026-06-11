import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AnswerResult } from '@ichtys/rag'
import { aggregateResults, evaluateFormalCase } from './metrics'
import { FormalEvalDatasetSchema, type CaseResult, type EvalSuiteResult, type FormalEvalCase } from './types'

// ---------------------------------------------------------------------------
// Adapter contract — keeps the runner testable without a live server
// ---------------------------------------------------------------------------

/**
 * Receives a question and studyId, returns an AnswerResult.
 * Implement with the HTTP adapter (makeHttpAdapter) for real runs,
 * or with a mock for unit tests.
 */
export type AnswerAdapter = (
  question: string,
  studyId: string,
) => Promise<AnswerResult>

// ---------------------------------------------------------------------------
// HTTP adapter — calls /api/rag/answer-test
// ---------------------------------------------------------------------------

export interface HttpAdapterConfig {
  baseUrl: string
  authCookie: string
}

/**
 * Builds an AnswerAdapter that POSTs to /api/rag/answer-test.
 * Requires ENABLE_INTERNAL_RAG_ANSWER_TEST=true on the server.
 * The server must have a valid Clerk session cookie passed via authCookie.
 *
 * To run against a local dev server:
 *   EVAL_BASE_URL=http://localhost:3000
 *   EVAL_AUTH_COOKIE=<paste from browser DevTools → Application → Cookies>
 *   EVAL_STUDY_ID=<uuid of the mock metabolic study>
 *   ENABLE_INTERNAL_RAG_ANSWER_TEST=true
 *   RATE_LIMIT_ENABLED=false
 */
export function makeHttpAdapter(config: HttpAdapterConfig): AnswerAdapter {
  return async (question: string, studyId: string): Promise<AnswerResult> => {
    const url = `${config.baseUrl}/api/rag/answer-test`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: config.authCookie,
      },
      body: JSON.stringify({ studyId, question }),
    })

    if (!response.ok) {
      throw new Error(`answer-test returned ${response.status}: ${await response.text()}`)
    }

    const data = (await response.json()) as {
      answer: string
      confidence: string
      evidences: AnswerResult['evidences']
    }
    return {
      answer: data.answer,
      confidence: data.confidence as AnswerResult['confidence'],
      evidences: data.evidences,
    }
  }
}

// ---------------------------------------------------------------------------
// Cookie / JWT helpers
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

// ---------------------------------------------------------------------------
// BAPI JWT refresh — uses Clerk Backend API with CLERK_SECRET_KEY
// ---------------------------------------------------------------------------

interface BapiConfig {
  secretKey: string
  sessionId: string
}

/**
 * Extracts BAPI config from the cookie string.
 * Uses clerk_active_context=<sessionId>:<orgId> or falls back to the __session JWT sid claim.
 * Returns null if CLERK_SECRET_KEY is not set or session ID is not found.
 */
function extractBapiConfig(cookieStr: string): BapiConfig | null {
  const secretKey = process.env['CLERK_SECRET_KEY']
  if (!secretKey?.startsWith('sk_')) return null

  const cookies = parseCookies(cookieStr)

  // clerk_active_context = "sessionId:orgId" — reliable even when __session is expired
  const activeCtx = cookies['clerk_active_context']
  if (activeCtx) {
    const [sessionId] = activeCtx.split(':')
    if (sessionId?.startsWith('sess_')) return { secretKey, sessionId }
  }

  // Fallback: extract from __session JWT sid claim
  const sessionJwt = cookies['__session']
  if (sessionJwt) {
    try {
      const payload = decodeJwtPayload(sessionJwt)
      const sid = payload['sid']
      if (typeof sid === 'string' && sid.startsWith('sess_')) return { secretKey, sessionId: sid }
    } catch { /* ignore */ }
  }

  return null
}

async function bapiGetToken(cfg: BapiConfig): Promise<string> {
  const resp = await fetch(`https://api.clerk.com/v1/sessions/${cfg.sessionId}/tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      'Content-Type': 'application/json',
    },
  })
  const rawBody = await resp.text()
  if (!resp.ok) {
    if (resp.status === 404 || resp.status === 410) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[evals] FATAL: Clerk session ${cfg.sessionId} not found or revoked (${resp.status}). ` +
        'Log into localhost:3000, copy fresh cookies, and re-run.',
      )
      process.exit(1)
    }
    throw new Error(`BAPI ${resp.status}: ${rawBody.slice(0, 200)}`)
  }
  const data = JSON.parse(rawBody) as Record<string, unknown>
  const jwt = data['jwt']
  if (typeof jwt !== 'string' || !jwt) throw new Error(`BAPI: no jwt in response — ${rawBody.slice(0, 200)}`)
  return jwt
}

// ---------------------------------------------------------------------------
// Cookie jar — merges Set-Cookie response headers into the outgoing cookie string
// ---------------------------------------------------------------------------

function mergeCookieJar(currentCookies: string, setCookieHeaders: string[]): string {
  const jar: Record<string, string> = {}
  for (const part of currentCookies.split(';')) {
    const eq = part.trim().indexOf('=')
    if (eq > 0) {
      jar[part.trim().slice(0, eq).trim()] = part.trim().slice(eq + 1).trim()
    }
  }
  for (const header of setCookieHeaders) {
    const firstSegment = header.split(';')[0]!.trim()
    const eqIdx = firstSegment.indexOf('=')
    if (eqIdx <= 0) continue
    const name = firstSegment.slice(0, eqIdx).trim()
    const value = firstSegment.slice(eqIdx + 1).trim()
    if (name) jar[name] = value
  }
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

function replaceSession(cookieStr: string, freshJwt: string): string {
  const parts = cookieStr.split(';').map((p) => p.trim())
  let replaced = false
  const updated = parts.map((p) => {
    if (p.startsWith('__session=')) { replaced = true; return `__session=${freshJwt}` }
    // Also update suffixed variant if present (e.g. __session_Kc0H-txM)
    if (/^__session_[A-Za-z0-9-]+=/.test(p)) return p.replace(/=.*/, `=${freshJwt}`)
    return p
  })
  if (!replaced) updated.unshift(`__session=${freshJwt}`)
  return updated.join('; ')
}

/**
 * HTTP adapter with automatic JWT refresh via Clerk Backend API.
 *
 * Reads CLERK_SECRET_KEY from env to generate fresh session JWTs as needed.
 * Extracts sessionId from clerk_active_context cookie (works even when __session
 * is already expired). Falls back to concurrency-based timing if CLERK_SECRET_KEY
 * is not available.
 */
export function makeRefreshableHttpAdapter(config: HttpAdapterConfig): AnswerAdapter {
  let currentCookie = config.authCookie
  // JWT minteado vía BAPI. Se envía además como Authorization: Bearer porque
  // clerkMiddleware acepta Bearer sin el handshake de cookies del dev instance
  // (__client_uat / __clerk_db_jwt), que solo existe en un browser real.
  let currentJwt: string | null = null
  const bapiCfg = extractBapiConfig(currentCookie)

  // eslint-disable-next-line no-console
  console.log(`[evals] auth mode: ${bapiCfg ? 'BAPI (CLERK_SECRET_KEY available — auto-refresh enabled)' : 'cookie-only (no CLERK_SECRET_KEY — JWT must be fresh at start)'}`)

  return async (question: string, studyId: string): Promise<AnswerResult> => {
    // Refresh JWT via BAPI if TTL is low or already expired.
    if (bapiCfg) {
      const sessionJwt = parseCookies(currentCookie)['__session'] ?? ''
      const secsLeft = secondsUntilExpiry(sessionJwt)
      if (secsLeft < 30) {
        try {
          const freshJwt = await bapiGetToken(bapiCfg)
          currentCookie = replaceSession(currentCookie, freshJwt)
          currentJwt = freshJwt
          const freshTtl = secondsUntilExpiry(freshJwt)
          const freshPayload = decodeJwtPayload(freshJwt)
          const hasOrg = !!(freshPayload['o'] as Record<string, unknown> | undefined)?.['id']
          // eslint-disable-next-line no-console
          console.log(`[evals] JWT refreshed via BAPI — TTL=${freshTtl}s org=${hasOrg ? 'present' : 'MISSING'}`)
          if (!hasOrg) {
            // eslint-disable-next-line no-console
            console.error('[evals] FATAL: BAPI JWT lacks org claim. Ensure you are a member of the org.')
            process.exit(1)
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[evals] JWT refresh failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } else {
      // No BAPI available — validate initial JWT on first call only.
      const sessionJwt = parseCookies(currentCookie)['__session'] ?? ''
      const secsLeft = secondsUntilExpiry(sessionJwt)
      if (secsLeft === 0) {
        throw new Error(
          'JWT expired and CLERK_SECRET_KEY is not available for refresh. ' +
          'Copy fresh cookies within 30s of logging in.',
        )
      }
    }

    const url = `${config.baseUrl}/api/rag/answer-test`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: currentCookie,
        ...(currentJwt ? { Authorization: `Bearer ${currentJwt}` } : {}),
      },
      body: JSON.stringify({ studyId, question }),
    })

    // Capture Set-Cookie from server — defensive update of cookie jar.
    const setCookieHeaders = response.headers.getSetCookie?.() ?? []
    if (setCookieHeaders.length > 0) {
      currentCookie = mergeCookieJar(currentCookie, setCookieHeaders)
    }

    if (!response.ok) {
      throw new Error(`answer-test returned ${response.status}: ${await response.text()}`)
    }

    const data = (await response.json()) as {
      answer: string
      confidence: string
      evidences: AnswerResult['evidences']
    }
    return {
      answer: data.answer,
      confidence: data.confidence as AnswerResult['confidence'],
      evidences: data.evidences,
    }
  }
}

// ---------------------------------------------------------------------------
// Dataset loader
// ---------------------------------------------------------------------------

function loadDataset(datasetPath: string): FormalEvalCase[] {
  const raw = JSON.parse(readFileSync(datasetPath, 'utf-8')) as unknown
  const parsed = FormalEvalDatasetSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `Dataset validation failed: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    )
  }
  return parsed.data.cases
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface RunEvalsConfig {
  adapter: AnswerAdapter
  studyId: string
  baseUrl: string
  datasetPath: string
  outputDir: string
  quick?: boolean
  /**
   * Maximum number of cases to run concurrently.
   * Default=4 — completes 12 cases in ~3 LLM-latency slots (~21s), well within
   * the 60s Clerk JWT window so no token refresh is needed.
   */
  concurrency?: number
}

const QUICK_LIMIT = 5

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runMockMetabolicEvals(config: RunEvalsConfig): Promise<EvalSuiteResult> {
  const allCases = loadDataset(config.datasetPath)
  const cases = config.quick ? allCases.slice(0, QUICK_LIMIT) : allCases
  const runId = crypto.randomUUID()
  const timestamp = new Date().toISOString()
  const concurrency = config.concurrency ?? 4

  // eslint-disable-next-line no-console
  console.log(
    `[evals] run=${runId} study=${config.studyId} cases=${cases.length} ` +
    `quick=${config.quick ?? false} concurrency=${concurrency}`,
  )

  // Pre-allocate results array to preserve case order.
  const results: CaseResult[] = new Array(cases.length) as CaseResult[]

  async function runCase(evalCase: FormalEvalCase, idx: number): Promise<void> {
    const start = Date.now()
    let result: CaseResult
    try {
      const answer = await config.adapter(evalCase.question, config.studyId)
      result = evaluateFormalCase(evalCase, answer, Date.now() - start)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      result = {
        caseId: evalCase.id,
        question: evalCase.question,
        expectedConfidence: evalCase.expectedConfidence,
        actualConfidence: 'unknown',
        answerSnippet: '',
        evidenceCount: 0,
        matchedExpectedKeywords: false,
        forbiddenKeywordsFound: false,
        matchedExpectedSection: null,
        insufficientEvidenceCorrect: false,
        status: 'ERROR',
        failureType: 'runtime_error',
        failureReason: message.slice(0, 300),
        durationMs: Date.now() - start,
      }
    }
    results[idx] = result
    // eslint-disable-next-line no-console
    console.log(
      `  ${result.status.padEnd(5)} ${result.caseId} (${result.durationMs}ms)` +
      `${result.failureType ? ` — ${result.failureType}` : ''}`,
    )
  }

  // Bounded concurrency pool — N workers pull from a shared index.
  let nextIdx = 0
  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIdx++
      if (idx >= cases.length) break
      await runCase(cases[idx]!, idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker))

  const suiteResult = aggregateResults(results, runId, config.studyId, config.baseUrl, timestamp)
  await writeOutput(suiteResult, config.outputDir, runId)
  return suiteResult
}

// ---------------------------------------------------------------------------
// Output (JSON + CSV)
// ---------------------------------------------------------------------------

async function writeOutput(result: EvalSuiteResult, outputDir: string, runId: string): Promise<void> {
  await mkdir(outputDir, { recursive: true })

  const jsonPath = join(outputDir, `eval-results-${runId}.json`)
  const csvPath = join(outputDir, `eval-results-${runId}.csv`)

  // JSON — full result (snippets already capped at 300 chars in scoreCase)
  await writeFile(jsonPath, JSON.stringify(result, null, 2), 'utf-8')

  // CSV — flat summary per case
  const csvHeader = [
    'caseId', 'status', 'failureType', 'actualConfidence', 'expectedConfidence',
    'evidenceCount', 'matchedKeywords', 'matchedSection', 'insufficientEvidenceCorrect',
    'forbiddenKeywordsFound', 'durationMs',
  ].join(',')

  const csvRows = result.cases.map((c) =>
    [
      c.caseId,
      c.status,
      c.failureType ?? '',
      c.actualConfidence,
      c.expectedConfidence,
      c.evidenceCount,
      c.matchedExpectedKeywords,
      c.matchedExpectedSection ?? 'N/A',
      c.insufficientEvidenceCorrect,
      c.forbiddenKeywordsFound,
      c.durationMs,
    ].join(','),
  )

  await writeFile(csvPath, [csvHeader, ...csvRows].join('\n'), 'utf-8')

  // eslint-disable-next-line no-console
  console.log(`\n[evals] results → ${jsonPath}`)
  // eslint-disable-next-line no-console
  console.log(`[evals] results → ${csvPath}`)
}

// ---------------------------------------------------------------------------
// Summary printer
// ---------------------------------------------------------------------------

export function printSummary(result: EvalSuiteResult): void {
  // eslint-disable-next-line no-console
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVAL SUITE — MOCK METABOLIC T2D
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Run:            ${result.runId}
Timestamp:      ${result.timestamp}
Study:          ${result.studyId}

RESULTS
  Total:        ${result.totalCases}
  PASS:         ${result.passCount}
  FAIL:         ${result.failCount}
  ERROR:        ${result.errorCount}
  Pass rate:    ${(result.passRate * 100).toFixed(1)}%

METRICS
  Insufficient evidence accuracy: ${(result.insufficientEvidenceAccuracy * 100).toFixed(1)}%
  Keyword match rate:              ${(result.keywordMatchRate * 100).toFixed(1)}%
  Section match rate:              ${(result.sectionMatchRate * 100).toFixed(1)}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

const isMain = process.argv[1]?.endsWith('runner.ts') || process.argv[1]?.endsWith('runner.js')
if (isMain) {
  const studyId = process.env['EVAL_STUDY_ID']
  const baseUrl = process.env['EVAL_BASE_URL'] ?? 'http://localhost:3000'
  const authCookie = process.env['EVAL_AUTH_COOKIE'] ?? ''
  const outputDir = process.env['EVAL_OUTPUT_DIR'] ?? 'docs/evals/results'
  const quick = process.argv.includes('--quick')

  if (!studyId) {
    // eslint-disable-next-line no-console
    console.error('[evals] ERROR: EVAL_STUDY_ID is required')
    // eslint-disable-next-line no-console
    console.error('  Set EVAL_STUDY_ID to the UUID of the mock metabolic study.')
    process.exit(1)
  }

  if (!authCookie) {
    // eslint-disable-next-line no-console
    console.error('[evals] ERROR: EVAL_AUTH_COOKIE is required')
    // eslint-disable-next-line no-console
    console.error(
      '  Set EVAL_AUTH_COOKIE to the FULL cookie string from browser DevTools.\n' +
      '  Must include __session AND __clerk_db_jwt (needed for automatic JWT refresh).\n' +
      '  Steps: localhost:3000/sign-in → DevTools → Application → Cookies → copy all.\n' +
      '  Also ensure ENABLE_INTERNAL_RAG_ANSWER_TEST=true and RATE_LIMIT_ENABLED=false on the server.',
    )
    process.exit(1)
  }

  if (!authCookie.includes('__clerk_db_jwt') || !authCookie.includes('__refresh_')) {
    // eslint-disable-next-line no-console
    console.warn(
      '[evals] WARNING: EVAL_AUTH_COOKIE is missing __clerk_db_jwt and/or __refresh_* cookies.\n' +
      '  The server cannot auto-refresh the JWT — eval will fail after the 60s JWT window.\n' +
      '  Copy the FULL cookie string from DevTools (Application → Cookies → localhost:3000).',
    )
  }

  const datasetPath = fileURLToPath(new URL('./dataset/mock-metabolic-eval-cases.json', import.meta.url))

  runMockMetabolicEvals({
    adapter: makeRefreshableHttpAdapter({ baseUrl, authCookie }),
    studyId,
    baseUrl,
    datasetPath,
    outputDir,
    quick,
    concurrency: 4,
  })
    .then((report) => {
      printSummary(report)
      process.exit(report.failCount === 0 && report.errorCount === 0 ? 0 : 1)
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.error('[evals] fatal:', message)
      process.exit(1)
    })
}

// ---------------------------------------------------------------------------
// Legacy exports (backwards compat with pre-10B code)
// ---------------------------------------------------------------------------

export { aggregate, aggregateResults, evaluateCase, evaluateFormalCase } from './metrics'
export type { AggregateMetrics, CaseEvaluation } from './metrics'
