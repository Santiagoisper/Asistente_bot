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
// Cookie jar — captures Set-Cookie from server responses
// ---------------------------------------------------------------------------

/**
 * Merges new cookies from a Set-Cookie response header into the existing
 * cookie string. The server's Clerk middleware may auto-refresh the JWT
 * when a request arrives with an expired __session but a valid __refresh_*
 * token. Capturing the resulting Set-Cookie headers lets us reuse the fresh
 * JWT for subsequent requests without needing to call Clerk FAPI directly.
 */
function mergeCookieJar(currentCookies: string, setCookieHeaders: string[]): string {
  const jar: Record<string, string> = {}
  for (const part of currentCookies.split(';')) {
    const eq = part.trim().indexOf('=')
    if (eq > 0) {
      jar[part.trim().slice(0, eq).trim()] = part.trim().slice(eq + 1).trim()
    }
  }
  for (const header of setCookieHeaders) {
    // Each Set-Cookie header: "name=value; Path=/; HttpOnly; ..."
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

/**
 * Like makeHttpAdapter but with pre-flight JWT validation and cookie jar tracking.
 *
 * Clerk JWTs have a 60s TTL. The runner uses concurrency=4 to complete all 12
 * cases in ~21s — well within the JWT window — so no server-side refresh is
 * needed. The pre-flight check enforces that the initial JWT carries org context
 * (o.id) and is not already expired before sending any requests.
 *
 * Set-Cookie headers from responses are captured and merged into the cookie jar
 * as a defensive measure in case the server issues a refreshed JWT mid-run.
 */
export function makeRefreshableHttpAdapter(config: HttpAdapterConfig): AnswerAdapter {
  let currentCookie = config.authCookie

  // Pre-flight: log initial JWT TTL so the operator can gauge timing.
  const initialJwt = parseCookies(currentCookie)['__session']
  if (initialJwt) {
    const ttl = secondsUntilExpiry(initialJwt)
    const payload = decodeJwtPayload(initialJwt)
    const hasOrg = !!(payload['o'] as Record<string, unknown> | undefined)?.['id']
    // eslint-disable-next-line no-console
    console.log(`[evals] initial JWT TTL=${ttl}s org=${hasOrg ? 'present' : 'MISSING'}`)
    if (!hasOrg) {
      // eslint-disable-next-line no-console
      console.error(
        '[evals] FATAL: initial JWT lacks org claim (o.id). ' +
        'Log into localhost:3000 with your org active, copy cookies, and re-run.',
      )
      process.exit(1)
    }
    if (ttl === 0) {
      // eslint-disable-next-line no-console
      console.error(
        '[evals] FATAL: JWT already expired (TTL=0). ' +
        'Copy cookies immediately after logging in, then run eval within 30s.',
      )
      process.exit(1)
    }
    if (ttl < 30) {
      // eslint-disable-next-line no-console
      console.warn(
        `[evals] WARNING: JWT TTL=${ttl}s is low. ` +
        'With concurrency=4 the run takes ~21s — likely OK but re-copying cookies is safer.',
      )
    }
  }

  return async (question: string, studyId: string): Promise<AnswerResult> => {
    const url = `${config.baseUrl}/api/rag/answer-test`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: currentCookie,
      },
      body: JSON.stringify({ studyId, question }),
    })

    // Capture Set-Cookie from response — Clerk middleware may have refreshed the JWT.
    const setCookieHeaders = response.headers.getSetCookie?.() ?? []
    if (setCookieHeaders.length > 0) {
      currentCookie = mergeCookieJar(currentCookie, setCookieHeaders)
      const freshJwt = parseCookies(currentCookie)['__session']
      const freshTtl = freshJwt ? secondsUntilExpiry(freshJwt) : 0
      if (freshTtl > 0) {
        // eslint-disable-next-line no-console
        console.log(`[evals] JWT refreshed via Set-Cookie — new TTL=${freshTtl}s`)
      }
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
