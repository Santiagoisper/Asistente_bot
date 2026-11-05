/**
 * Línea de base del extractor en 090e506 contra los fixtures F1–F5.
 *
 * Sin ANTHROPIC_API_KEY no llama a la red y no inventa contadores.
 * Con clave, corre solo el grupo de visitas (visitsOnly) y corta antes
 * del fixture siguiente si el gasto estimado llega a 3 USD.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ICHTYS = resolve(HERE, '../..')
const REPO_ROOT = resolve(ICHTYS, '..')
const FIXTURES = resolve(ICHTYS, 'fixtures/soa')
const OUT = resolve(FIXTURES, 'baseline.json')
export const EXTRACTOR_SHA = '090e506c90775e9c6dba0478477405a0106192c1'
/** Árbol git de ichtys/packages/ingestion en EXTRACTOR_SHA. El checkout lo compara sin traer ese commit. */
export const EXTRACTOR_TREE = '60521881832d2545f214b46477819651d849c8c9'
const SPEND_CAP_USD = 3
const IDS = ['F1', 'F2', 'F3', 'F4', 'F5'] as const

export function extractorTreeMatches(expectedTree = EXTRACTOR_TREE, repoRoot = REPO_ROOT): boolean {
  if (!/^[0-9a-f]{40}$/.test(expectedTree)) return false
  try {
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'ichtys/packages/ingestion'], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    const tree = execFileSync('git', ['rev-parse', '--verify', 'HEAD:ichtys/packages/ingestion'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()
    return tree === expectedTree
  } catch {
    return false
  }
}

interface UsageCall {
  inputTokens: number
  outputTokens: number
  model: string
}

function loadKey(): boolean {
  const current = process.env.ANTHROPIC_API_KEY?.trim()
  if (current) return true
  const path = resolve(ICHTYS, '.env.local')
  if (!existsSync(path)) return false
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const body = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed
    const eq = body.indexOf('=')
    if (eq < 0 || body.slice(0, eq).trim() !== 'ANTHROPIC_API_KEY') continue
    let value = body.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!value) return false
    process.env.ANTHROPIC_API_KEY = value
    return true
  }
  return false
}

function pricePerMTok(model: string): { input: number; output: number } {
  const id = model.toLowerCase()
  if (id.startsWith('claude-opus-5-5')) return { input: 4, output: 20 }
  if (id.startsWith('claude-opus')) return { input: 15, output: 75 }
  return { input: 15, output: 75 }
}

function costOf(call: UsageCall): number {
  const price = pricePerMTok(call.model)
  return (call.inputTokens * price.input + call.outputTokens * price.output) / 1_000_000
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function installFetchMeter(bucket: { spent: number }): () => void {
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const response = await original(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (!url.includes('api.anthropic.com')) return response
    try {
      const body = (await response.clone().json()) as {
        usage?: { input_tokens?: number; output_tokens?: number }
        model?: string
      }
      const usage = body.usage
      if (!usage) return response
      const call: UsageCall = {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        model: typeof body.model === 'string' ? body.model : (process.env.SPEC_EXTRACTION_MODEL ?? 'claude-opus-5-5'),
      }
      bucket.spent += costOf(call)
    } catch {
      // Sin JSON de uso no hay costo. El cuerpo no se registra.
    }
    return response
  }
  return () => {
    globalThis.fetch = original
  }
}

function writeNotRun(): never {
  const payload = {
    status: 'not_run',
    reason: 'NO VERIFICADO',
    detail:
      'No hay ANTHROPIC_API_KEY en el entorno ni en ichtys/.env.local. El extractor de 090e506 solo llama a Anthropic. No se inventaron contadores.',
    extractorSha: EXTRACTOR_SHA,
    spendCapUsd: SPEND_CAP_USD,
    visitsOnly: true,
    fixtures: null,
  }
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`)
  process.stderr.write('baseline: NO VERIFICADO (sin clave de Anthropic). No se llamó a la red.\n')
  process.exit(2)
}

async function measure(full: boolean): Promise<void> {
  const bucket = { spent: 0 }
  const restore = installFetchMeter(bucket)
  const fixtures: Record<string, unknown> = {}
  try {
    const { parsePdf } = await import('../../packages/ingestion/parser.ts')
    const { extractStudySpec } = await import('../../packages/ingestion/spec-extractor.ts')
    const { adaptLegacyVisits, scoreSchedule, toPrivate } = await import('./score.ts')
    for (const id of IDS) {
      if (bucket.spent >= SPEND_CAP_USD) {
        fixtures[id] = { status: 'skipped', reason: 'spend cap' }
        continue
      }
      const spentBefore = bucket.spent
      const pdf = readFileSync(resolve(FIXTURES, `${id}.pdf`))
      const gold = JSON.parse(readFileSync(resolve(FIXTURES, `${id}.gold.json`), 'utf8')) as {
        tables?: Array<{ key: string; pages?: number[] }>
      }
      const started = performance.now()
      try {
        const parsed = await parsePdf(pdf)
        const result = await extractStudySpec(parsed.pages, [], {
          visitsOnly: !full,
          protocolPdf: new Uint8Array(pdf),
        })
        const candidate = adaptLegacyVisits(
          { visits: result.spec.visits as never },
          gold,
        )
        candidate.meta = {
          costUsd: round(bucket.spent - spentBefore),
          latencyS: round((performance.now() - started) / 1000),
        }
        fixtures[id] = {
          status: 'measured',
          extractionModel: result.extractionModel,
          warningCount: result.warnings.length,
          counters: toPrivate(scoreSchedule(gold, candidate)),
        }
      } catch (error) {
        fixtures[id] = {
          status: 'error',
          reason: error instanceof Error ? error.name : 'error',
          costUsd: round(bucket.spent - spentBefore),
        }
      }
    }
  } finally {
    restore()
  }
  writeFileSync(OUT, `${JSON.stringify({
    status: 'measured',
    reason: null,
    extractorSha: EXTRACTOR_SHA,
    spendCapUsd: SPEND_CAP_USD,
    spentUsd: round(bucket.spent),
    visitsOnly: !full,
    fixtures,
  }, null, 2)}\n`)
}

function isDirectRun(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entry))
  } catch {
    return false
  }
}

function refuseMismatchedTree(): never {
  process.stderr.write(
    `baseline: ichtys/packages/ingestion no coincide con el árbol de ${EXTRACTOR_SHA}. No se escribió baseline.json.\n`,
  )
  process.exit(1)
}

if (isDirectRun()) {
  if (!extractorTreeMatches()) refuseMismatchedTree()
  const full = process.argv.includes('--full')
  if (!loadKey()) writeNotRun()
  measure(full).catch((error: unknown) => {
    process.stderr.write(`baseline: ${error instanceof Error ? error.name : 'error'}\n`)
    process.exit(1)
  })
}
