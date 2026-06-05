import { aggregate, evaluateCase, type AggregateMetrics, type EvalCase } from './metrics'

/**
 * runner.ts — corre el eval suite contra el answer engine.
 *
 * Uso:
 *   pnpm evals:run          # dataset completo (~100 preguntas clínicas)
 *   pnpm evals:quick        # subset de 20
 *
 * El dataset vive en ./dataset (PRD §14: dataset de evaluación clínica desde
 * el día 1). Incluye casos adversariales de leakage cross-tenant/cross-study,
 * cuyo target es 0% y es BLOQUEANTE para release (CLAUDE.md).
 */

export interface EvalReport {
  metrics: AggregateMetrics
  quick: boolean
  passed: boolean
}

const QUICK_LIMIT = 20

/** Carga el dataset de casos clínicos. */
async function loadDataset(quick: boolean): Promise<EvalCase[]> {
  // TODO(paso-10): cargar casos reales desde ./dataset/*.json.
  const cases: EvalCase[] = []
  return quick ? cases.slice(0, QUICK_LIMIT) : cases
}

export async function runEvals(quick = false): Promise<EvalReport> {
  const cases = await loadDataset(quick)

  const evaluations = await Promise.all(
    cases.map(async (testCase) => {
      // TODO(paso-10): invocar generateAnswer y evaluar contra el caso.
      void evaluateCase
      throw new Error('eval execution not implemented (paso 10)')
    }),
  )

  const metrics = aggregate(evaluations)

  // Gate de release: leakage debe ser 0%.
  const passed =
    metrics.crossTenantLeakageRate === 0 && metrics.crossStudyLeakageRate === 0

  return { metrics, quick, passed }
}

// CLI entrypoint
const isMain = process.argv[1]?.endsWith('runner.ts')
if (isMain) {
  const quick = process.argv.includes('--quick')
  runEvals(quick)
    .then((report) => {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(report, null, 2))
      process.exit(report.passed ? 0 : 1)
    })
    .catch((err: unknown) => {
      console.error(err)
      process.exit(1)
    })
}
