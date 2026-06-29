import type { Confidence } from './answer-engine'
import type { TerminologySuggestion } from './medical-annotator'

/**
 * terminology-answer.ts — compone la respuesta híbrida para preguntas de
 * codificación clínica (SNOMED-CT / LOINC).
 *
 * Política (ADR-004, CLAUDE.md 6): ALPHI responde solo desde documentos. Pero
 * cuando el usuario pide un código de terminología y el protocolo no lo contiene,
 * "evidencia insuficiente" es confuso: el concepto SÍ existe en el protocolo, lo
 * que falta es el código. La solución es una respuesta de dos bloques:
 *
 *   Bloque A — lo que dice el protocolo (grounded, con citas si las hay).
 *   Bloque B — codificación sugerida, marcada explícitamente como EXTERNA al
 *              protocolo (terminología estándar del diccionario validado).
 *
 * La sugerencia NUNCA se presenta como contenido del documento.
 */

export const TERMINOLOGY_DISCLAIMER =
  'Estos códigos no provienen del protocolo. Son una sugerencia de terminología clínica estándar (SNOMED-CT / LOINC) para los conceptos mencionados, basada en el diccionario validado de ALPHI.'

const NO_MATCH_MESSAGE =
  'No encontré este concepto en el protocolo ni en el vocabulario de terminología (SNOMED-CT / LOINC) disponible.'

const PROTOCOL_WITHOUT_CODES =
  'El protocolo no incluye códigos ni terminología de codificación clínica (SNOMED-CT, LOINC, CIE-10) para este concepto.'

export type TerminologyAnswer = {
  /** Texto final persistido (Bloque A + Bloque B). Reload-safe. */
  answer: string
  confidence: Confidence
  /** Códigos sugeridos para render estructurado. [] si no hubo match. */
  terminologySuggestions: TerminologySuggestion[]
  /** true si el protocolo aportó evidencia grounded sobre el concepto. */
  protocolMentionsFound: boolean
}

function formatSuggestionLine(s: TerminologySuggestion): string {
  return `- ${s.display} → ${s.system} ${s.code}`
}

/**
 * Compone la respuesta de terminología a partir del resultado del answer engine
 * (Bloque A) y las sugerencias del diccionario (Bloque B).
 *
 * Reglas de confianza:
 *  - medium: el protocolo aportó evidencia + hay código sugerido.
 *  - low: solo hay sugerencia externa (el protocolo no menciona el concepto).
 *  - insufficient_evidence: ni protocolo ni diccionario tienen el concepto.
 */
export function buildTerminologyAnswer(params: {
  protocolAnswer: string
  protocolConfidence: Confidence
  suggestions: TerminologySuggestion[]
}): TerminologyAnswer {
  const { protocolAnswer, protocolConfidence, suggestions } = params
  const protocolMentionsFound = protocolConfidence !== 'insufficient_evidence'

  if (suggestions.length === 0) {
    if (!protocolMentionsFound) {
      return {
        answer: NO_MATCH_MESSAGE,
        confidence: 'insufficient_evidence',
        terminologySuggestions: [],
        protocolMentionsFound: false,
      }
    }
    // El protocolo respondió pero no hay código en el diccionario: devolver tal cual.
    return {
      answer: protocolAnswer,
      confidence: protocolConfidence,
      terminologySuggestions: [],
      protocolMentionsFound: true,
    }
  }

  const blockA = protocolMentionsFound ? protocolAnswer.trim() : PROTOCOL_WITHOUT_CODES

  const blockB = [
    'Codificación sugerida:',
    ...suggestions.map(formatSuggestionLine),
    '',
    TERMINOLOGY_DISCLAIMER,
  ].join('\n')

  const confidence: Confidence = protocolMentionsFound ? 'medium' : 'low'

  return {
    answer: `${blockA}\n\n${blockB}`,
    confidence,
    terminologySuggestions: suggestions,
    protocolMentionsFound,
  }
}
