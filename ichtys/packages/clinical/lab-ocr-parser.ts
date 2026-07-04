import { extractFactsFromEvolution } from './extract-facts'
import type { LabObservation } from './profile-schema'
import { redactPhiForLlm } from './phi-redact'

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

/** Redacta encabezados típicos de PDF de laboratorio antes de parsear. */
export function redactLabHeaderPii(text: string): { text: string; redactedCount: number } {
  let { text: result, redactedCount } = redactPhiForLlm(text)

  const headerLine = /^(?:Paciente|Nombre|Apellido|DNI|Documento|ID\s*Paciente)\s*:.*$/gim
  result = result.replace(headerLine, (line) => {
    redactedCount += 1
    const label = line.split(':')[0] ?? 'Campo'
    return `${label}: [REDACTED]`
  })

  return { text: result, redactedCount }
}

const LAB_LINE_PATTERNS: Array<{
  pattern: RegExp
  name: string
  unit?: string
}> = [
  { pattern: /hemoglobina\s+glicosilada\s*:?\s*(\d+[.,]\d+)\s*%?/i, name: 'HbA1c', unit: '%' },
  { pattern: /hba1c\s*:?\s*(\d+[.,]\d+)\s*%?/i, name: 'HbA1c', unit: '%' },
  { pattern: /glucosa\s*(?:en\s+ayunas)?\s*:?\s*(\d+[.,]?\d*)\s*(?:mg\/dl|mg\/dL)?/i, name: 'Glucosa', unit: 'mg/dL' },
  { pattern: /creatinina\s*:?\s*(\d+[.,]?\d*)\s*(?:mg\/dl|mg\/dL)?/i, name: 'Creatinina', unit: 'mg/dL' },
  {
    pattern: /(?:eGFR|TFG|filtrado\s+glomerular)\s*:?\s*(\d+[.,]?\d*)/i,
    name: 'eGFR',
    unit: 'mL/min',
  },
]

export interface LabOcrParseResult {
  requiresHumanReview: true
  labs: LabObservation[]
  redactedPreview: string
  piiRedactedCount: number
}

/**
 * Parser determinista de texto OCR de laboratorio (URS-007).
 * Siempre devuelve requiresHumanReview — no persistir en profile.labs sin confirmación.
 */
export function parseLabOcrText(rawText: string): LabOcrParseResult {
  const { text: redacted, redactedCount } = redactLabHeaderPii(rawText.trim())

  let labs: LabObservation[] = []
  const fromEvolution = extractFactsFromEvolution(redacted)
  for (const lab of fromEvolution.labs) {
    labs = upsertLab(labs, lab)
  }

  for (const { pattern, name, unit } of LAB_LINE_PATTERNS) {
    const match = redacted.match(pattern)
    if (match?.[1]) {
      labs = upsertLab(labs, { name, value: parseDecimal(match[1]), unit })
    }
  }

  return {
    requiresHumanReview: true,
    labs,
    redactedPreview: redacted.slice(0, 400),
    piiRedactedCount: redactedCount,
  }
}

export function mergeConfirmedLabs(
  currentLabs: LabObservation[],
  confirmed: LabObservation[],
): LabObservation[] {
  let labs = [...currentLabs]
  for (const lab of confirmed) {
    labs = upsertLab(labs, lab)
  }
  return labs
}
