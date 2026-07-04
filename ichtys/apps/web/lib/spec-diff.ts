/**
 * spec-diff.ts — motor de diff estructural entre dos StudySpec.
 *
 * Pure TypeScript — sin LLM, sin I/O.
 * Compara criterios (por número), endpoints (LCS por firma + tipo), visitas (por nombre).
 * Para procedimientos y endpoints usa LCS para detectar adiciones/remociones.
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
      const prevRow = dp[i - 1]!
      const curRow = dp[i]!
      curRow[j] =
        a[i - 1] === b[j - 1]
          ? prevRow[j - 1]! + 1
          : Math.max(prevRow[j]!, curRow[j - 1]!)
    }
  }
  // Backtrack
  const result: string[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    const ai = a[i - 1]!
    const bj = b[j - 1]!
    if (ai === bj) {
      result.unshift(ai)
      i--
      j--
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--
    } else {
      j--
    }
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
// Diff de endpoints — alineados por contenido (LCS) para tolerar inserciones
// ---------------------------------------------------------------------------
//
// El matching posicional marcaba como "modificados" todos los endpoints
// posteriores a una inserción en el medio. Se ancla primero con LCS sobre la
// firma exacta (type+objective+endpoint); los sueltos entre anclas se emparejan
// por tipo para distinguir edición real ('modified') de alta/baja.

const ENDPOINT_TYPE_ORDER = ['primary', 'secondary', 'exploratory'] as const

/** Firma exacta de un endpoint para anclar coincidencias en la LCS. */
function endpointSig(e: StudyEndpoint): string {
  return `${e.type} ${normText(e.objective)} ${normText(e.endpoint)}`
}

/** Pares de indices (i,j) alineados por LCS sobre firmas, preservando orden. */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const prevRow = dp[i - 1]!
      const curRow = dp[i]!
      curRow[j] =
        a[i - 1] === b[j - 1]
          ? prevRow[j - 1]! + 1
          : Math.max(prevRow[j]!, curRow[j - 1]!)
    }
  }
  const pairs: Array<[number, number]> = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.unshift([i - 1, j - 1])
      i--
      j--
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i--
    } else {
      j--
    }
  }
  return pairs
}

function endpointChanged(o: StudyEndpoint, n: StudyEndpoint): boolean {
  return (
    normText(o.objective) !== normText(n.objective) ||
    normText(o.endpoint) !== normText(n.endpoint) ||
    o.type !== n.type
  )
}

/**
 * Empareja los endpoints "sueltos" de un hueco (entre anclas) por tipo y
 * posicion relativa: old[k] vs new[k] del mismo tipo -> 'modified' (o
 * 'unchanged' si son identicos); los sobrantes -> 'removed' / 'added'.
 */
function pairGap(
  oldGap: StudyEndpoint[],
  newGap: StudyEndpoint[],
  emit: (d: Omit<EndpointDiff, 'index'>) => void,
): void {
  for (const type of ENDPOINT_TYPE_ORDER) {
    const olds = oldGap.filter((e) => e.type === type)
    const news = newGap.filter((e) => e.type === type)
    const paired = Math.min(olds.length, news.length)
    for (let k = 0; k < paired; k++) {
      const o = olds[k]!, n = news[k]!
      emit({ diffType: endpointChanged(o, n) ? 'modified' : 'unchanged', old: o, new: n })
    }
    for (let k = paired; k < olds.length; k++) {
      emit({ diffType: 'removed', old: olds[k]!, new: null })
    }
    for (let k = paired; k < news.length; k++) {
      emit({ diffType: 'added', old: null, new: news[k]! })
    }
  }
}

function diffEndpoints(
  oldList: StudyEndpoint[],
  newList: StudyEndpoint[],
): EndpointDiff[] {
  const anchors = lcsPairs(oldList.map(endpointSig), newList.map(endpointSig))

  const diffs: EndpointDiff[] = []
  let idx = 0
  const emit = (d: Omit<EndpointDiff, 'index'>) => {
    diffs.push({ ...d, index: idx++ })
  }

  let i = 0, j = 0
  // Sentinel final para vaciar el ultimo hueco despues de la ultima ancla.
  const marks: Array<[number, number]> = [...anchors, [oldList.length, newList.length]]
  for (const [mi, mj] of marks) {
    pairGap(oldList.slice(i, mi), newList.slice(j, mj), emit)
    if (mi < oldList.length && mj < newList.length) {
      // Ancla: firmas identicas => sin cambios.
      emit({ diffType: 'unchanged', old: oldList[mi]!, new: newList[mj]! })
    }
    i = mi + 1
    j = mj + 1
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
