import type { CriterionAssessment, PatientProfile } from './profile-schema'

export interface EligibilityCriterionInput {
  number: string
  text: string
}

export interface ScreeningInput {
  inclusionCriteria: EligibilityCriterionInput[]
  exclusionCriteria: EligibilityCriterionInput[]
}

function getLabValue(profile: PatientProfile, name: string): number | undefined {
  const lab = profile.labs.find((l) => l.name.toLowerCase() === name.toLowerCase())
  return lab?.value
}

function parseHbA1cRange(text: string): { min?: number; max?: number } | null {
  const normalized = text.replace(',', '.')
  const rangeMatch = normalized.match(
    /HbA1c[^0-9]*(?:≥|>=|>)\s*(\d+(?:\.\d+)?)[^0-9]*(?:y|<|≤|<=)\s*(\d+(?:\.\d+)?)/i,
  )
  if (rangeMatch) {
    return {
      min: Number.parseFloat(rangeMatch[1] ?? '0'),
      max: Number.parseFloat(rangeMatch[2] ?? '0'),
    }
  }
  const minOnly = normalized.match(/HbA1c[^0-9]*(?:≥|>=|>)\s*(\d+(?:\.\d+)?)/i)
  if (minOnly) return { min: Number.parseFloat(minOnly[1] ?? '0') }
  return null
}

function assessHbA1cCriterion(
  criterion: EligibilityCriterionInput,
  kind: 'inclusion' | 'exclusion',
  profile: PatientProfile,
): CriterionAssessment | null {
  if (!/HbA1c/i.test(criterion.text)) return null

  const range = parseHbA1cRange(criterion.text)
  const value = getLabValue(profile, 'HbA1c')

  if (value === undefined) {
    return {
      criterionNumber: criterion.number,
      criterionText: criterion.text,
      kind,
      status: 'unknown',
      reason: 'HbA1c no documentado en el perfil del sujeto.',
    }
  }

  if (!range) {
    return {
      criterionNumber: criterion.number,
      criterionText: criterion.text,
      kind,
      status: 'unknown',
      reason: `HbA1c ${value}% registrado; no se pudo parsear el rango del criterio automáticamente.`,
    }
  }

  const withinMin = range.min === undefined || value >= range.min
  const withinMax = range.max === undefined || value < range.max
  const passesRange = withinMin && withinMax

  if (kind === 'inclusion') {
    return {
      criterionNumber: criterion.number,
      criterionText: criterion.text,
      kind,
      status: passesRange ? 'pass' : 'fail',
      reason: passesRange
        ? `HbA1c ${value}% dentro del rango esperado.`
        : `HbA1c ${value}% fuera del rango del criterio.`,
    }
  }

  return {
    criterionNumber: criterion.number,
    criterionText: criterion.text,
    kind,
    status: passesRange ? 'fail' : 'pass',
    reason: passesRange
      ? `HbA1c ${value}% activaría este criterio de exclusión.`
      : `HbA1c ${value}% no activa este criterio de exclusión.`,
  }
}

function assessMedicationCriterion(
  criterion: EligibilityCriterionInput,
  kind: 'inclusion' | 'exclusion',
  profile: PatientProfile,
): CriterionAssessment | null {
  if (!/metformina/i.test(criterion.text)) return null

  const hasMetformin = profile.medications.some((m) => /metformina/i.test(m.name))
  if (kind === 'inclusion') {
    if (/permitid|estable|≥\s*1000/i.test(criterion.text)) {
      return {
        criterionNumber: criterion.number,
        criterionText: criterion.text,
        kind,
        status: hasMetformin ? 'pass' : 'unknown',
        reason: hasMetformin
          ? 'Metformina detectada en el perfil; verificar dosis/estabilidad manualmente.'
          : 'Metformina no detectada en el perfil.',
      }
    }
  }

  if (kind === 'exclusion' && /prohibid|contraindic/i.test(criterion.text)) {
    return {
      criterionNumber: criterion.number,
      criterionText: criterion.text,
      kind,
      status: hasMetformin ? 'fail' : 'pass',
      reason: hasMetformin
        ? 'Metformina presente — revisar contra exclusión.'
        : 'Metformina no detectada.',
    }
  }

  return null
}

function assessGeneric(
  criterion: EligibilityCriterionInput,
  kind: 'inclusion' | 'exclusion',
): CriterionAssessment {
  return {
    criterionNumber: criterion.number,
    criterionText: criterion.text,
    kind,
    status: 'unknown',
    reason: 'Requiere revisión manual — regla automática no disponible.',
  }
}

/**
 * Motor determinista Fase 2 — evalúa solo criterios con datos estructurados en el perfil.
 * LLM no decide elegibilidad (AI-GOVERNANCE).
 */
export function assessScreening(
  profile: PatientProfile,
  input: ScreeningInput,
): CriterionAssessment[] {
  const results: CriterionAssessment[] = []

  for (const criterion of input.inclusionCriteria) {
    results.push(
      assessHbA1cCriterion(criterion, 'inclusion', profile) ??
        assessMedicationCriterion(criterion, 'inclusion', profile) ??
        assessGeneric(criterion, 'inclusion'),
    )
  }

  for (const criterion of input.exclusionCriteria) {
    results.push(
      assessHbA1cCriterion(criterion, 'exclusion', profile) ??
        assessMedicationCriterion(criterion, 'exclusion', profile) ??
        assessGeneric(criterion, 'exclusion'),
    )
  }

  return results
}

export function screeningSummary(assessments: CriterionAssessment[]): {
  pass: number
  fail: number
  unknown: number
} {
  return assessments.reduce(
    (acc, a) => {
      acc[a.status] += 1
      return acc
    },
    { pass: 0, fail: 0, unknown: 0 },
  )
}
