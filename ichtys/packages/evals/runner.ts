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
  /** Delay in ms between requests to avoid hitting rate limits. Default 200ms. */
  requestDelayMs?: number
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

  // eslint-disable-next-line no-console
  console.log(`[evals] run=${runId} study=${config.studyId} cases=${cases.length} quick=${config.quick ?? false}`)

  const results: CaseResult[] = []

  for (const evalCase of cases) {
    const start = Date.now()
    let result: CaseResult

    try {
      const answer = await config.adapter(evalCase.question, config.studyId)
      const durationMs = Date.now() - start
      result = evaluateFormalCase(evalCase, answer, durationMs)
    } catch (err: unknown) {
      const durationMs = Date.now() - start
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
        durationMs,
      }
    }

    results.push(result)
    // eslint-disable-next-line no-console
    console.log(`  ${result.status.padEnd(5)} ${result.caseId} (${result.durationMs}ms)${result.failureType ? ` — ${result.failureType}` : ''}`)

    if (config.requestDelayMs && config.requestDelayMs > 0) {
      await delay(config.requestDelayMs)
    }
  }

  const suiteResult = aggregateResults(results, runId, config.studyId, config.baseUrl, timestamp)

  await writeOutput(suiteResult, config.outputDir, runId)

  return suiteResult
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
      '  Set EVAL_AUTH_COOKIE to a valid Clerk session cookie from the browser.\n' +
      '  Also ensure ENABLE_INTERNAL_RAG_ANSWER_TEST=true and RATE_LIMIT_ENABLED=false on the server.',
    )
    process.exit(1)
  }

  const datasetPath = fileURLToPath(new URL('./dataset/mock-metabolic-eval-cases.json', import.meta.url))

  runMockMetabolicEvals({
    adapter: makeHttpAdapter({ baseUrl, authCookie }),
    studyId,
    baseUrl,
    datasetPath,
    outputDir,
    quick,
    requestDelayMs: 250,
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
