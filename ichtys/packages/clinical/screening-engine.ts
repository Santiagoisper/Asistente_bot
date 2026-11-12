import type { CriterionAssessment, LabObservation, PatientProfile } from './profile-schema'
import {
  alignLabToBounds,
  compareWithBounds,
  describeBoundComparison,
  formatClinicalNumber,
  parseAgeBounds,
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

function findAnalyteLab(profile: PatientProfile, analyte: LabAnalyte): LabObservation | undefined {
  return profile.labs.find((lab) => textMentionsAnalyte(lab.name, analyte))
}

function assessAnalyteCriterion(
  analyte: LabAnalyte,
  criterion: EligibilityCriterionInput,
  kind: 'inclusion' | 'exclusion',
  profile: PatientProfile,
): CriterionAssessment | null {
  if (!textMentionsAnalyte(criterion.text, analyte)) return null

  const bounds = parseAnalyteBounds(criterion.text, analyte)
  const lab = findAnalyteLab(profile, analyte)

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
      reason: `${analyte} no documentado en el perfil del sujeto.`,
    }
  }

  if (!bounds) {
    return {
      ...base,
      status: 'unknown',
      reason: `${analyte} ${formatClinicalNumber(lab.value)} registrado; no se pudo parsear el rango del criterio automáticamente.`,
    }
  }

  const aligned = alignLabToBounds(lab.value, lab.unit, bounds)
  if ('unknown' in aligned) {
    return { ...base, status: 'unknown', reason: aligned.unknown }
  }

  const satisfies = compareWithBounds(aligned.value, bounds)
  const citation = describeBoundComparison(analyte, aligned.value, bounds, satisfies)

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

/** Analitos de laboratorio que el motor sabe comparar contra el criterio. */
type LabAnalyte = 'HbA1c' | 'eGFR'
const LAB_ANALYTES: readonly LabAnalyte[] = ['HbA1c', 'eGFR']

function assessLabCriterion(
  criterion: EligibilityCriterionInput,
  kind: 'inclusion' | 'exclusion',
  profile: PatientProfile,
): CriterionAssessment | null {
  for (const analyte of LAB_ANALYTES) {
    const assessment = assessAnalyteCriterion(analyte, criterion, kind, profile)
    if (assessment) return assessment
  }
  return null
}

function ageBoundsText(bounds: { min?: { value: number }; max?: { value: number } }): string {
  if (bounds.min && bounds.max) return `entre ${bounds.min.value} y ${bounds.max.value} años`
  if (bounds.min) return `mínimo ${bounds.min.value} años`
  return `máximo ${bounds.max?.value} años`
}

/** Criterio de edad contra la edad del perfil (que una persona aceptó). */
function assessAgeCriterion(
  criterion: EligibilityCriterionInput,
  kind: 'inclusion' | 'exclusion',
  profile: PatientProfile,
): CriterionAssessment | null {
  const bounds = parseAgeBounds(criterion.text)
  if (!bounds) return null
  const base = {
    criterionNumber: criterion.number,
    criterionText: criterion.text,
    kind,
    sourcePages: criterion.sourcePages,
  }
  const age = profile.demographics?.ageYears
  if (age === undefined) {
    return { ...base, status: 'unknown', reason: 'Edad no documentada en el perfil del sujeto.' }
  }
  const inside =
    (!bounds.min || (bounds.min.inclusive ? age >= bounds.min.value : age > bounds.min.value)) &&
    (!bounds.max || (bounds.max.inclusive ? age <= bounds.max.value : age < bounds.max.value))
  const citation = `Edad ${age} años; el criterio pide ${ageBoundsText(bounds)}`
  if (kind === 'inclusion') {
    return { ...base, status: inside ? 'pass' : 'fail', reason: inside ? citation : `${citation}: no se cumple` }
  }
  return {
    ...base,
    status: inside ? 'fail' : 'pass',
    reason: inside ? `${citation}: activaría este criterio de exclusión.` : `${citation}: no activa este criterio de exclusión.`,
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
 * Negación pura: TODA la condición registrada es la negación. «Sin antecedentes de
 * pancreatitis», «Niega pancreatitis», «No refiere episodios de pancreatitis aguda».
 * Si la frase dice algo más («Niega pancreatitis, pero tuvo una en 2019», «sin fiebre,
 * con pancreatitis crónica», «niega pancreatitis aunque tuvo un episodio») no despeja
 * nada: cuenta como antecedente. Ante la duda gana el lado que obliga a mirar.
 */
const NEGATED_PANCREATITIS =
  /^\s*(?:sin|niega|descarta|no\s+(?:presenta|refiere|tiene|registra|hay))\s+(?:(?:antecedentes?|historia|episodios?|cuadros?|diagn[oó]stico)\s+)?(?:(?:previ[oa]s?|personal(?:es)?)\s+)?(?:de\s+)?pancreatitis(?:\s+(?:aguda|cr[oó]nica|previa|conocida))*\s*\.?\s*$/i

function assessConditionCriterion(
  criterion: EligibilityCriterionInput,
  kind: 'inclusion' | 'exclusion',
  profile: PatientProfile,
): CriterionAssessment | null {
  if (kind !== 'exclusion') return null
  if (!/pancreatitis/i.test(criterion.text)) return null

  // Una exclusión no se despeja por falta de datos: que el antecedente no figure en el
  // perfil no prueba que no exista. Solo una negación pura registrada ("sin antecedentes de
  // pancreatitis", y nada más en esa frase) la despeja; cualquier otra mención la activa;
  // sin mención, queda a revisar.
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
      assessLabCriterion(criterion, 'inclusion', profile) ??
        assessAgeCriterion(criterion, 'inclusion', profile) ??
        assessMedicationCriterion(criterion, 'inclusion', profile) ??
        assessGeneric(criterion, 'inclusion'),
    )
  }

  for (const criterion of input.exclusionCriteria) {
    results.push(
      assessLabCriterion(criterion, 'exclusion', profile) ??
        assessAgeCriterion(criterion, 'exclusion', profile) ??
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
