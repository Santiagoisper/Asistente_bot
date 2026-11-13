import type { CriterionAssessment, LabObservation, MissingDatum, PatientProfile } from './profile-schema'
import {
  alignLabToBounds,
  compareWithBounds,
  describeBoundComparison,
  formatClinicalNumber,
  parseAgeBounds,
  parseAnalyteBounds,
  textMentionsAnalyte,
} from './numeric-criteria'
import { clearingPhrases, deniesTerm, HISTORY_TERMS, isBareNegation, type HistoryTerm } from './stated-history'

interface EligibilityCriterionInput {
  number: string
  text: string
  sourcePages?: number[]
}

export interface ScreeningInput {
  inclusionCriteria: EligibilityCriterionInput[]
  exclusionCriteria: EligibilityCriterionInput[]
}

/** Cómo se nombra cada medida en los motivos que lee la persona. */
const ANALYTE_LABEL: Record<LabAnalyte, string> = { HbA1c: 'HbA1c', eGFR: 'eGFR', BMI: 'IMC' }

function findAnalyteLab(profile: PatientProfile, analyte: LabAnalyte): (LabObservation & { derived?: string }) | undefined {
  const direct = profile.labs.find((lab) => textMentionsAnalyte(lab.name, analyte))
  if (direct || analyte !== 'BMI') return direct
  // Sin IMC registrado, se calcula con el peso y la talla del perfil, y el motivo lo dice.
  const weight = profile.labs.find((lab) => /^peso\b/i.test(lab.name) && (lab.unit ?? 'kg') === 'kg')
  const height = profile.labs.find((lab) => /^(?:talla|altura|estatura)\b/i.test(lab.name))
  if (!weight || !height) return undefined
  const metres = height.unit === 'm' ? height.value : height.value / 100
  if (metres <= 0) return undefined
  const value = weight.value / (metres * metres)
  // Un IMC fuera de 10–80 no es un IMC: alguno de los dos datos está mal cargado.
  if (value < 10 || value > 80) return undefined
  return {
    name: 'IMC',
    value,
    unit: 'kg/m2',
    derived: `calculado con peso ${formatClinicalNumber(weight.value)} kg y talla ${formatClinicalNumber(metres * 100)} cm`,
  }
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
      reason:
        analyte === 'BMI'
          ? 'IMC no documentado en el perfil del sujeto: falta el IMC, o el peso y la talla.'
          : `${analyte} no documentado en el perfil del sujeto.`,
      missing: [analyte === 'BMI' ? 'weight-height' : analyte === 'HbA1c' ? 'hba1c' : 'egfr'],
    }
  }

  if (!bounds) {
    return {
      ...base,
      status: 'unknown',
      reason: `${ANALYTE_LABEL[analyte]} ${formatClinicalNumber(lab.value)} registrado; no se pudo parsear el rango del criterio automáticamente.`,
    }
  }

  const aligned = alignLabToBounds(lab.value, lab.unit, bounds)
  if ('unknown' in aligned) {
    return { ...base, status: 'unknown', reason: aligned.unknown }
  }

  const satisfies = compareWithBounds(aligned.value, bounds)
  const described = describeBoundComparison(analyte, aligned.value, bounds, satisfies).replace(/^BMI\b/, 'IMC')
  const citation = lab.derived ? `${described} (${lab.derived})` : described

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
type LabAnalyte = 'HbA1c' | 'eGFR' | 'BMI'
const LAB_ANALYTES: readonly LabAnalyte[] = ['HbA1c', 'eGFR', 'BMI']

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
    return { ...base, status: 'unknown', reason: 'Edad no documentada en el perfil del sujeto.', missing: ['age'] }
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
      // Verde quiere decir comprobado. Que la metformina figure en el perfil no comprueba
      // cuánto hace que la toma, si la dosis es estable ni si llega a la dosis pedida: el
      // perfil no guarda esos datos. Si el criterio los pide, queda a revisar y lo dice.
      const asksMore = /estable|≥\s*\d|\b\d+\s*(?:d[ií]as?|semanas?|mes(?:es)?|a[ñn]os?)\b/i.test(criterion.text)
      return {
        criterionNumber: criterion.number,
        criterionText: criterion.text,
        kind,
        status: hasMetformin && !asksMore ? 'pass' : 'unknown',
        reason: !hasMetformin
          ? 'Metformina no figura en la medicación registrada.'
          : asksMore
            ? 'Metformina registrada en el perfil. El criterio pide además tiempo, estabilidad o dosis del tratamiento, y eso no está registrado: confirmarlo antes de darlo por cumplido.'
            : 'Metformina registrada en el perfil.',
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

/** Palabras de un criterio que no piden nada: artículos, nexos y la forma de nombrar un antecedente. */
const CRITERION_FILLER = new Set(
  ('a al de del la el los las o u y e ni en con que cualquier ' +
    'personal personales actual actuales curso cursando diagnostico ' +
    'conocida conocido documentada documentado clinica clinico aguda agudo cronica cronico ' +
    'mujer mujeres paciente pacientes sujeto sujetos participante participantes periodo este esten presencia ' +
    // Lo mismo en inglés: los criterios de un protocolo suelen venir así.
    'of any the an and or at time to enrollment enrolment screening known current currently ' +
    'acute chronic documented clinical diagnosis who are is woman women female females patient patients subject subjects participant participants').split(' '),
)

/**
 * Palabras que hablan de la historia. No piden nada si el criterio es sobre un antecedente
 * («antecedente de pancreatitis»). Sobre un estado sí: «embarazo previo» o «antecedente de
 * embarazo ectópico» preguntan por la historia, y el sistema solo comprueba el estado de hoy.
 */
const HISTORY_FILLER = new Set('antecedente antecedentes historia previa previo previas previos history previous prior'.split(' '))

/**
 * El criterio nombra algo más que los términos que el motor comprueba («… o de carcinoma
 * medular de tiroides», «… en los últimos 5 años»). Con eso, negar lo que sí comprueba no
 * alcanza para despejarlo.
 */
function asksBeyondTerms(criterionText: string, terms: ReadonlyArray<HistoryTerm>): boolean {
  const words = criterionText
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/breast-feeding/g, 'breastfeeding')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
  const aboutHistoryOnly = terms.every((term) => term.nature === 'history')
  return words.some(
    (word) => !CRITERION_FILLER.has(word) && !(aboutHistoryOnly && HISTORY_FILLER.has(word)) && !terms.some((term) => term.mention.test(word)),
  )
}

function assessConditionCriterion(
  criterion: EligibilityCriterionInput,
  kind: 'inclusion' | 'exclusion',
  profile: PatientProfile,
): CriterionAssessment | null {
  if (kind !== 'exclusion') return null
  const asked = HISTORY_TERMS.filter((term) => term.mention.test(criterion.text))
  if (asked.length === 0) return null

  // Una exclusión no se despeja por falta de datos: que no figure en el perfil no prueba que
  // no exista. Por cada cosa que el criterio nombra: una mención sin negar la activa; una
  // negación pura la despeja; sin mención, queda a revisar.
  // Tres casos por mención, no dos. La niega de forma pura y hablando de lo mismo: despeja.
  // Es una negación entera de otra cosa («no presenta pancreatitis» para un antecedente, «sin
  // antecedentes de embarazo» para un estado, «sin signos de…»): ni despeja ni afirma, el dato
  // sigue faltando. Cualquier otra mención cuenta como afirmada.
  const affirmed: string[] = []
  const missing: string[] = []
  const notEnough: string[] = []
  const missingData: MissingDatum[] = []
  const missingTerms: HistoryTerm[] = []
  for (const term of asked) {
    const mentions = profile.conditions.filter((condition) => term.mention.test(condition))
    const denied = mentions.some((condition) => deniesTerm(condition, term))
    const others = mentions.filter((condition) => !deniesTerm(condition, term))
    if (others.some((condition) => !isBareNegation(condition))) affirmed.push(term.label)
    else if (!denied) {
      missing.push(term.label)
      missingData.push(term.datum)
      missingTerms.push(term)
      notEnough.push(...others)
    }
  }
  const asksMore = asksBeyondTerms(criterion.text, asked)
  // Si el criterio pide algo más, ni lo negado lo despeja ni lo afirmado lo activa solo: el
  // resto puede agregar una alternativa («… o carcinoma medular») o acotarlo («… en los
  // últimos 5 años»), y eso el sistema no lo comprueba.
  const status = asksMore ? 'unknown' : affirmed.length > 0 ? 'fail' : missing.length > 0 ? 'unknown' : 'pass'
  const beyond = 'El criterio pide además algo que el sistema no comprueba: revisarlo antes de decidir.'
  const list = (labels: string[]) => labels.join(' ni ')
  return {
    criterionNumber: criterion.number,
    criterionText: criterion.text,
    kind,
    status,
    reason:
      status === 'fail'
        ? `Registrado en el perfil: ${affirmed.join(' y ')}.`
        : status === 'pass'
          ? `El perfil registra que no hay ${list(asked.map((term) => term.label))}.`
          : affirmed.length > 0
            ? `Registrado en el perfil: ${affirmed.join(' y ')}. ${beyond}`
            : missing.length > 0
              ? `${
                  notEnough.length > 0
                    ? `El perfil dice ${[...new Set(notEnough)].map((phrase) => `«${phrase}»`).join(' y ')}, y eso no alcanza para ${list(missing)}.`
                    : `El perfil no registra ${list(missing)}: que no figure no prueba que no exista.`
                } Confirmarlo y dejarlo dicho (${clearingPhrases(missingTerms).map((phrase) => `«${phrase}»`).join(' y ')}).${asksMore ? ` ${beyond}` : ''}`
              : `El perfil registra que no hay ${list(asked.map((term) => term.label))}. ${beyond}`,
    // Se pide el dato solo si con él alcanza: si ya hay algo afirmado, decirlo no cambia nada.
    ...(status === 'unknown' && affirmed.length === 0 && missingData.length > 0 ? { missing: missingData } : {}),
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
