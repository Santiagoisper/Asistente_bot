import { extractFactsFromEvolution } from './extract-facts'
import { parseDecimal, upsertLab } from './lab-utils'
import type { LabObservation } from './profile-schema'
import { redactPhiForLlm } from './phi-redact'

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

/** Cada patrón termina en el número (grupo 1). La unidad se lee aparte, de lo que sigue. */
const LAB_LINE_PATTERNS: Array<{
  pattern: RegExp
  name: string
  unit?: string
}> = [
  { pattern: /hemoglobina\s+glicosilada\s*:?\s*(\d+[.,]\d+)/i, name: 'HbA1c', unit: '%' },
  // «Hemoglobina glicosilada (HbA1c): 7,8 %»: el paréntesis que cierra queda antes de los dos puntos.
  { pattern: /hba1c\)?\s*:?\s*(\d+[.,]\d+)/i, name: 'HbA1c', unit: '%' },
  // «Glucemia» es como la informan los laboratorios de acá; es el mismo analito y se guarda
  // con el mismo nombre, para que no quede duplicado con una «Glucosa» que venga de otra fuente.
  {
    pattern: /(?:glucosa|glucemia|glicemia)\s*(?:en\s+ayunas|basal)?\s*:?\s*(\d+[.,]?\d*)/i,
    name: 'Glucosa',
    unit: 'mg/dL',
  },
  { pattern: /creatinina\s*:?\s*(\d+[.,]?\d*)/i, name: 'Creatinina', unit: 'mg/dL' },
  {
    pattern: /(?:eGFR|TFG|filtrado\s+glomerular)\s*:?\s*(\d+[.,]?\d*)/i,
    name: 'eGFR',
    unit: 'mL/min',
  },
]

/** Una unidad pegada al número: `%`, `mg%`, o algo con barra (`mg/dL`, `mmol/L`, `mL/min/1,73m2`). */
const WRITTEN_UNIT = /^\s*(%|[a-zµμ]+%|[a-zµμ]+(?:\/[a-z0-9.,²]+){1,2})/i

/**
 * La unidad del valor. Si el texto trae una unidad distinta de la habitual, manda la escrita:
 * proponer «7,3 mmol/L» como «7,3 mg/dL» es proponer otro valor. Si trae la habitual (con
 * otra forma de escribirla, o con algo más detrás) o no trae ninguna, queda la habitual.
 */
function unitFor(afterNumber: string, usual: string | undefined): string | undefined {
  const written = afterNumber.match(WRITTEN_UNIT)?.[1]
  if (!written || !usual) return written ?? usual
  return written.toLowerCase().startsWith(usual.toLowerCase()) ? usual : written
}

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
      const afterNumber = redacted.slice((match.index ?? 0) + match[0].length)
      labs = upsertLab(labs, { name, value: parseDecimal(match[1]), unit: unitFor(afterNumber, unit) })
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
