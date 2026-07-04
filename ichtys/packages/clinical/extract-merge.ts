import type { ExtractedFacts } from './extract-facts'
import type { FieldConfidenceLevel, PatientProfile, ProfileFieldConfidence } from './profile-schema'

function numbersClose(a: number, b: number, tolerance = 0.05): boolean {
  return Math.abs(a - b) <= tolerance
}

function labKey(name: string): string {
  return name.toLowerCase()
}

function confidenceForScalar(
  heuristic?: number,
  llm?: number,
): FieldConfidenceLevel | undefined {
  if (heuristic !== undefined && llm !== undefined) {
    return numbersClose(heuristic, llm) ? 'high' : 'medium'
  }
  if (llm !== undefined) return 'medium'
  if (heuristic !== undefined) return 'low'
  return undefined
}

function mergeRecordConfidence(
  current: Record<string, FieldConfidenceLevel> | undefined,
  key: string,
  level: FieldConfidenceLevel | undefined,
): Record<string, FieldConfidenceLevel> | undefined {
  if (!level) return current
  return { ...current, [key]: level }
}

export interface MergedExtraction {
  facts: ExtractedFacts
  fieldConfidence: ProfileFieldConfidence
}

/**
 * Combina extracción heurística + LLM y calcula badges de confianza por campo.
 */
export function mergeExtractions(
  heuristic: ExtractedFacts,
  llm: ExtractedFacts | null,
): MergedExtraction {
  const llmFacts = llm ?? {
    labs: [],
    medications: [],
    conditions: [],
  }

  const ageYears = llmFacts.ageYears ?? heuristic.ageYears
  const systolic = llmFacts.systolic ?? heuristic.systolic
  const diastolic = llmFacts.diastolic ?? heuristic.diastolic

  const fieldConfidence: ProfileFieldConfidence = {
    ageYears: confidenceForScalar(heuristic.ageYears, llmFacts.ageYears),
    bloodPressure: confidenceForScalar(
      heuristic.systolic && heuristic.diastolic ? heuristic.systolic : undefined,
      llmFacts.systolic && llmFacts.diastolic ? llmFacts.systolic : undefined,
    ),
    labs: {},
    medications: {},
    conditions: {},
  }

  const labMap = new Map<string, ExtractedFacts['labs'][number]>()
  for (const lab of heuristic.labs) {
    labMap.set(labKey(lab.name), lab)
  }
  for (const lab of llmFacts.labs) {
    const key = labKey(lab.name)
    const prev = labMap.get(key)
    fieldConfidence.labs = mergeRecordConfidence(
      fieldConfidence.labs,
      key,
      confidenceForScalar(prev?.value, lab.value),
    )
    labMap.set(key, prev ? { ...prev, ...lab, value: lab.value } : lab)
  }
  for (const lab of heuristic.labs) {
    const key = labKey(lab.name)
    if (!llmFacts.labs.some((l) => labKey(l.name) === key)) {
      fieldConfidence.labs = mergeRecordConfidence(fieldConfidence.labs, key, 'low')
    }
  }

  const medNames = new Set<string>()
  const medications: ExtractedFacts['medications'] = []
  for (const med of [...heuristic.medications, ...llmFacts.medications]) {
    const key = med.name.toLowerCase()
    if (medNames.has(key)) continue
    medNames.add(key)
    medications.push(med)
    const fromHeuristic = heuristic.medications.find((m) => m.name.toLowerCase() === key)
    const fromLlm = llmFacts.medications.find((m) => m.name.toLowerCase() === key)
    fieldConfidence.medications = mergeRecordConfidence(
      fieldConfidence.medications,
      key,
      fromHeuristic && fromLlm ? 'high' : fromLlm ? 'medium' : 'low',
    )
  }

  const conditionSet = new Set<string>()
  const conditions: string[] = []
  for (const c of [...heuristic.conditions, ...llmFacts.conditions]) {
    const key = c.toLowerCase()
    if (conditionSet.has(key)) continue
    conditionSet.add(key)
    conditions.push(c)
    const fromHeuristic = heuristic.conditions.some((x) => x.toLowerCase() === key)
    const fromLlm = llmFacts.conditions.some((x) => x.toLowerCase() === key)
    fieldConfidence.conditions = mergeRecordConfidence(
      fieldConfidence.conditions,
      key,
      fromHeuristic && fromLlm ? 'high' : fromLlm ? 'medium' : 'low',
    )
  }

  return {
    facts: {
      ageYears,
      systolic,
      diastolic,
      labs: [...labMap.values()],
      medications,
      conditions,
    },
    fieldConfidence,
  }
}

export function mergeProfileWithExtraction(
  current: PatientProfile,
  merged: MergedExtraction,
  evolutionId: string,
): PatientProfile {
  const { facts, fieldConfidence } = merged

  const labs = [...current.labs]
  for (const lab of facts.labs) {
    const idx = labs.findIndex((l) => l.name.toLowerCase() === lab.name.toLowerCase())
    const entry = { ...lab, sourceEvolutionId: evolutionId }
    if (idx === -1) labs.push(entry)
    else labs[idx] = entry
  }

  const medNames = new Set(current.medications.map((m) => m.name.toLowerCase()))
  const medications = [...current.medications]
  for (const med of facts.medications) {
    if (!medNames.has(med.name.toLowerCase())) {
      medications.push(med)
      medNames.add(med.name.toLowerCase())
    }
  }

  const conditionSet = new Set(current.conditions.map((c) => c.toLowerCase()))
  const conditions = [...current.conditions]
  for (const c of facts.conditions) {
    if (!conditionSet.has(c.toLowerCase())) {
      conditions.push(c)
      conditionSet.add(c.toLowerCase())
    }
  }

  return {
    version: 1,
    demographics: {
      ageYears: facts.ageYears ?? current.demographics?.ageYears,
    },
    vitals: {
      systolic: facts.systolic ?? current.vitals?.systolic,
      diastolic: facts.diastolic ?? current.vitals?.diastolic,
      bloodPressureLabel:
        facts.systolic && facts.diastolic
          ? `${facts.systolic}/${facts.diastolic}`
          : current.vitals?.bloodPressureLabel,
    },
    labs,
    medications,
    conditions,
    fieldConfidence: {
      ageYears: fieldConfidence.ageYears ?? current.fieldConfidence?.ageYears,
      bloodPressure: fieldConfidence.bloodPressure ?? current.fieldConfidence?.bloodPressure,
      labs: { ...current.fieldConfidence?.labs, ...fieldConfidence.labs },
      medications: { ...current.fieldConfidence?.medications, ...fieldConfidence.medications },
      conditions: { ...current.fieldConfidence?.conditions, ...fieldConfidence.conditions },
    },
    lastUpdatedAt: new Date().toISOString(),
    lastEvolutionId: evolutionId,
  }
}
