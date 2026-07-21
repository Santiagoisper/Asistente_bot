/**
 * spec-diff.ts — motor de diff estructural entre dos StudySpec.
 *
 * Pure TypeScript — sin LLM, sin I/O.
 * Compara criterios (por número), endpoints (por tipo+posición), visitas (por nombre).
 * Para procedimientos usa LCS para detectar adiciones/remociones.
 */

import type {
  StudySpec,
  EligibilityCriterion,
  StudyEndpoint,
  StudyVisit,
} from '@ichtys/ingestion'

// ---------------------------------------------------------------------------
// Tipos de diff
// ---------------------------------------------------------------------------

export type DiffType = 'added' | 'removed' | 'modified' | 'unchanged'

export interface CriterionDiff {
  diffType: DiffType
  key: string           // número del criterio (e.g. "3", "10a")
  old: EligibilityCriterion | null
  new: EligibilityCriterion | null
}

export interface EndpointDiff {
  diffType: DiffType
  index: number         // posición en el array más largo
  old: StudyEndpoint | null
  new: StudyEndpoint | null
}

export interface ProcedureDiff {
  diffType: DiffType
  text: string
}

export interface VisitDiff {
  diffType: DiffType
  key: string           // nombre de la visita
  old: StudyVisit | null
  new: StudyVisit | null
  /** Granular diff de procedimientos, presente cuando diffType === 'modified' */
  procedureDiffs: ProcedureDiff[]
}

export interface SpecDiffSummary {
  added: number
  removed: number
  modified: number
}

export interface SpecDiff {
  inclusionCriteria: CriterionDiff[]
  exclusionCriteria: CriterionDiff[]
  endpoints: EndpointDiff[]
  visits: VisitDiff[]
  /** true si al menos una sección tiene cambios */
  hasChanges: boolean
  summary: SpecDiffSummary
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** LCS sobre arrays de strings (para procedimientos). */
function lcs(a: string[], b: string[]): string[] {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  // Backtrack
  const result: string[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { result.unshift(a[i - 1]); i--; j-- }
    else if (dp[i - 1][j] > dp[i][j - 1]) { i-- }
    else { j-- }
  }
  return result
}

function diffProcedures(oldProcs: string[], newProcs: string[]): ProcedureDiff[] {
  const common = new Set(lcs(oldProcs, newProcs))
  const result: ProcedureDiff[] = []

  for (const p of oldProcs) {
    if (!common.has(p)) result.push({ diffType: 'removed', text: p })
    else result.push({ diffType: 'unchanged', text: p })
  }
  for (const p of newProcs) {
    if (!common.has(p)) result.push({ diffType: 'added', text: p })
  }
  return result
}

function normText(s: string) {
  return s.trim().replace(/\s+/g, ' ')
}

function criterionChanged(a: EligibilityCriterion, b: EligibilityCriterion): boolean {
  return normText(a.text) !== normText(b.text)
}

// ---------------------------------------------------------------------------
// Diff de criterios — emparejados por número
// ---------------------------------------------------------------------------

function diffCriteria(
  oldList: EligibilityCriterion[],
  newList: EligibilityCriterion[],
): CriterionDiff[] {
  const oldMap = new Map(oldList.map((c) => [c.number, c]))
  const newMap = new Map(newList.map((c) => [c.number, c]))

  const allKeys = [...new Set([...oldMap.keys(), ...newMap.keys()])]
  const diffs: CriterionDiff[] = []

  for (const key of allKeys) {
    const o = oldMap.get(key) ?? null
    const n = newMap.get(key) ?? null

    let diffType: DiffType
    if (!o) diffType = 'added'
    else if (!n) diffType = 'removed'
    else diffType = criterionChanged(o, n) ? 'modified' : 'unchanged'

    diffs.push({ diffType, key, old: o, new: n })
  }

  return diffs
}

// ---------------------------------------------------------------------------
// Diff de endpoints — emparejados por posición dentro de cada tipo
// ---------------------------------------------------------------------------

function diffEndpoints(
  oldList: StudyEndpoint[],
  newList: StudyEndpoint[],
): EndpointDiff[] {
  const len = Math.max(oldList.length, newList.length)
  const diffs: EndpointDiff[] = []

  for (let i = 0; i < len; i++) {
    const o = oldList[i] ?? null
    const n = newList[i] ?? null

    let diffType: DiffType
    if (!o) diffType = 'added'
    else if (!n) diffType = 'removed'
    else if (
      normText(o.objective) !== normText(n.objective) ||
      normText(o.endpoint) !== normText(n.endpoint) ||
      o.type !== n.type
    ) diffType = 'modified'
    else diffType = 'unchanged'

    diffs.push({ diffType, index: i, old: o, new: n })
  }

  return diffs
}

// ---------------------------------------------------------------------------
// Diff de visitas — emparejadas por nombre
// ---------------------------------------------------------------------------

function diffVisits(
  oldList: StudyVisit[],
  newList: StudyVisit[],
): VisitDiff[] {
  const oldMap = new Map(oldList.map((v) => [v.name, v]))
  const newMap = new Map(newList.map((v) => [v.name, v]))

  const allKeys = [...new Set([...oldMap.keys(), ...newMap.keys()])]
  const diffs: VisitDiff[] = []

  for (const key of allKeys) {
    const o = oldMap.get(key) ?? null
    const n = newMap.get(key) ?? null

    let diffType: DiffType
    let procedureDiffs: ProcedureDiff[] = []

    if (!o) {
      diffType = 'added'
    } else if (!n) {
      diffType = 'removed'
    } else {
      const propsChanged =
        o.label !== n.label ||
        o.day !== n.day ||
        o.windowDays !== n.windowDays

      const procDiffs = diffProcedures(o.procedures, n.procedures)
      const procsChanged = procDiffs.some((p) => p.diffType !== 'unchanged')

      diffType = propsChanged || procsChanged ? 'modified' : 'unchanged'
      procedureDiffs = procDiffs
    }

    diffs.push({ diffType, key, old: o, new: n, procedureDiffs })
  }

  return diffs
}

// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------

export function diffSpecs(oldSpec: StudySpec, newSpec: StudySpec): SpecDiff {
  const inclusionCriteria = diffCriteria(oldSpec.inclusionCriteria, newSpec.inclusionCriteria)
  const exclusionCriteria = diffCriteria(oldSpec.exclusionCriteria, newSpec.exclusionCriteria)
  const endpoints         = diffEndpoints(oldSpec.endpoints, newSpec.endpoints)
  const visits            = diffVisits(oldSpec.visits, newSpec.visits)

  const allDiffs = [
    ...inclusionCriteria,
    ...exclusionCriteria,
    ...endpoints,
    ...visits,
  ]

  const summary: SpecDiffSummary = {
    added:    allDiffs.filter((d) => d.diffType === 'added').length,
    removed:  allDiffs.filter((d) => d.diffType === 'removed').length,
    modified: allDiffs.filter((d) => d.diffType === 'modified').length,
  }

  const hasChanges = summary.added + summary.removed + summary.modified > 0

  return { inclusionCriteria, exclusionCriteria, endpoints, visits, hasChanges, summary }
}
