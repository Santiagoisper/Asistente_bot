import type { LabObservation, Medication, PatientProfile } from './profile-schema'

export interface ExtractedFacts {
  ageYears?: number
  systolic?: number
  diastolic?: number
  labs: LabObservation[]
  medications: Medication[]
  conditions: string[]
}

function parseDecimal(raw: string): number {
  return Number.parseFloat(raw.replace(',', '.'))
}

function upsertLab(labs: LabObservation[], entry: LabObservation): LabObservation[] {
  const idx = labs.findIndex((l) => l.name.toLowerCase() === entry.name.toLowerCase())
  if (idx === -1) return [...labs, entry]
  const next = [...labs]
  next[idx] = entry
  return next
}

/**
 * Extracción heurística Fase 2 — sin LLM, testeable y determinista.
 * Complementa (no reemplaza) extracción NLP futura.
 */
export function extractFactsFromEvolution(
  content: string,
  evolutionId?: string,
): ExtractedFacts {
  const text = content.trim()
  const labs: LabObservation[] = []
  const medications: Medication[] = []
  const conditions: string[] = []

  const ageMatch = text.match(/\b(\d{1,3})\s*a(?:ñ|n)os\b/i)
  const ageYears = ageMatch ? Number.parseInt(ageMatch[1] ?? '', 10) : undefined

  const bpMatch = text.match(/\b(\d{2,3})\s*\/\s*(\d{2,3})\b/)
  const systolic = bpMatch ? Number.parseInt(bpMatch[1] ?? '', 10) : undefined
  const diastolic = bpMatch ? Number.parseInt(bpMatch[2] ?? '', 10) : undefined

  const hba1cMatch = text.match(/HbA1c\s*(?:de\s*)?(\d+[.,]\d+)\s*%?/i)
  if (hba1cMatch) {
    labs.push({
      name: 'HbA1c',
      value: parseDecimal(hba1cMatch[1] ?? '0'),
      unit: '%',
      sourceEvolutionId: evolutionId,
    })
  }

  const glucosaMatch = text.match(/glucosa(?:\s+alta|\s+de\s+(\d+[.,]?\d*))/i)
  if (glucosaMatch?.[1]) {
    labs.push({
      name: 'Glucosa',
      value: parseDecimal(glucosaMatch[1]),
      unit: 'mg/dL',
      sourceEvolutionId: evolutionId,
    })
  } else if (/glucosa\s+alta/i.test(text)) {
    conditions.push('Glucosa elevada (texto libre)')
  }

  const medPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /metformina(?:\s+(\d+\s*mg))?(?:\s*(c\/\d+h|cada\s+\d+\s*h))?/i, name: 'Metformina' },
    { pattern: /insulina(?:\s+(\w+))?/i, name: 'Insulina' },
    { pattern: /semaglutida|ozempic|wegovy/i, name: 'Semaglutida (GLP-1)' },
    { pattern: /liraglutida|victoza/i, name: 'Liraglutida (GLP-1)' },
  ]

  for (const { pattern, name } of medPatterns) {
    const m = text.match(pattern)
    if (m) {
      medications.push({
        name,
        dose: m[1]?.trim(),
        frequency: m[2]?.trim(),
      })
    }
  }

  if (/\bDM2\b|diabetes tipo 2|diabetes mellitus tipo 2/i.test(text)) {
    conditions.push('DM2')
  }
  if (/sin GLP-1|sin glp-1/i.test(text)) {
    conditions.push('Sin GLP-1 activo')
  }

  return {
    ageYears,
    systolic,
    diastolic,
    labs,
    medications,
    conditions,
  }
}

export function mergeProfileWithFacts(
  current: PatientProfile,
  facts: ExtractedFacts,
  evolutionId: string,
): PatientProfile {
  let labs = [...current.labs]
  for (const lab of facts.labs) {
    labs = upsertLab(labs, { ...lab, sourceEvolutionId: evolutionId })
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
    lastUpdatedAt: new Date().toISOString(),
    lastEvolutionId: evolutionId,
  }
}
