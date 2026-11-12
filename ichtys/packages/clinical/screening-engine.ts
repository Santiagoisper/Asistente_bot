import type { CriterionAssessment, LabObservation, PatientProfile } from './profile-schema'
import {
  alignLabToBounds,
  compareWithBounds,
  describeBoundComparison,
  formatClinicalNumber,
  parseAnalyteBounds,
  textMentionsAnalyte,
} from './numeric-criteria'

interface EligibilityCriterionInput {
  number: string
  text: string
  sourcePages?: number[]
}

export interface ScreeningInput {
  inclusionCriteria: EligibilityCriterionInput[]
  exclusionCriteria: EligibilityCriterionInput[]
}

function findHbA1cLab(profile: PatientProfile): LabObservation | undefined {
  return profile.labs.find((lab) => textMentionsAnalyte(lab.name, 'HbA1c'))
}

function assessHbA1cCriterion(
  criterion: EligibilityCriterionInput,
  kind: 'inclusion' | 'exclusion',
  profile: PatientProfile,
): CriterionAssessment | null {
  if (!textMentionsAnalyte(criterion.text, 'HbA1c')) return null

  const bounds = parseAnalyteBounds(criterion.text, 'HbA1c')
  const lab = findHbA1cLab(profile)

  const base = {
    criterionNumber: criterion.number,
    criterionText: criterion.text,
    kind,
    sourcePages: criterion.sourcePages,
  }

  if (!lab) {
    return {
      ...base,
      status: 'unknown',
      reason: 'HbA1c no documentado en el perfil del sujeto.',
    }
  }

  if (!bounds) {
    return {
      ...base,
      status: 'unknown',
      reason: `HbA1c ${formatClinicalNumber(lab.value)} registrado; no se pudo parsear el rango del criterio automáticamente.`,
    }
  }

  const aligned = alignLabToBounds(lab.value, lab.unit, bounds)
  if ('unknown' in aligned) {
    return { ...base, status: 'unknown', reason: aligned.unknown }
  }

  const satisfies = compareWithBounds(aligned.value, bounds)
  const citation = describeBoundComparison('HbA1c', aligned.value, bounds, satisfies)

  if (kind === 'inclusion') {
    return {
      ...base,
      status: satisfies ? 'pass' : 'fail',
      reason: satisfies ? citation : `${citation} no se cumple`,
    }
  }

  return {
    ...base,
    status: satisfies ? 'fail' : 'pass',
    reason: satisfies
      ? `${citation}: activaría este criterio de exclusión.`
      : `${citation} no activa este criterio de exclusión.`,
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
        sourcePages: criterion.sourcePages,
      }
    }
  }

  if (kind === 'exclusion' && /prohibid|contraindic/i.test(criterion.text)) {
    return {
      criterionNumber: criterion.number,
      criterionText: criterion.text,
      kind,
      // Misma regla que en los antecedentes: que no figure no despeja la exclusión.
      status: hasMetformin ? 'fail' : 'unknown',
      reason: hasMetformin
        ? 'Metformina presente — revisar contra exclusión.'
        : 'Metformina no figura en la medicación registrada: que no figure no prueba que no la tome. Confirmar con la persona.',
      sourcePages: criterion.sourcePages,
    }
  }

  return null
}

/**
 * Negación pegada a la mención: «sin antecedentes de pancreatitis», «niega pancreatitis»,
 * «no refiere episodios de pancreatitis». Entre la negación y la palabra solo se admite un
 * puñado de palabras de relleno: «sin fiebre, con pancreatitis crónica» NO es una negación.
 * Ante la duda la mención cuenta como afirmada, que es el lado que obliga a mirar.
 */
const NEGATED_PANCREATITIS =
  /\b(?:sin|niega|descarta|no\s+(?:presenta|refiere|tiene|registra|hay))\s+(?:(?:antecedentes?|historia|episodios?|cuadros?|diagn[oó]stico)\s+)?(?:(?:previos?|personal(?:es)?)\s+)?(?:de\s+)?pancreatitis/i

function assessConditionCriterion(
  criterion: EligibilityCriterionInput,
  kind: 'inclusion' | 'exclusion',
  profile: PatientProfile,
): CriterionAssessment | null {
  if (kind !== 'exclusion') return null
  if (!/pancreatitis/i.test(criterion.text)) return null

  // Una exclusión no se despeja por falta de datos: que el antecedente no figure en el
  // perfil no prueba que no exista. Solo una negación registrada ("sin antecedentes de
  // pancreatitis") la despeja; una mención sin negar la activa; sin mención, queda a revisar.
  const mentions = profile.conditions.filter((c) => /pancreatitis/i.test(c))
  const affirmed = mentions.some((c) => !NEGATED_PANCREATITIS.test(c))
  const status = affirmed ? 'fail' : mentions.length > 0 ? 'pass' : 'unknown'
  return {
    criterionNumber: criterion.number,
    criterionText: criterion.text,
    kind,
    status,
    reason:
      status === 'fail'
        ? 'Antecedente de pancreatitis documentado en el perfil.'
        : status === 'pass'
          ? 'El perfil registra que no hay antecedente de pancreatitis.'
          : 'El perfil no registra antecedentes de pancreatitis: que no figure no prueba que no exista. Confirmar en la historia clínica.',
    sourcePages: criterion.sourcePages,
  }
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
    sourcePages: criterion.sourcePages,
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
        assessConditionCriterion(criterion, 'exclusion', profile) ??
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
