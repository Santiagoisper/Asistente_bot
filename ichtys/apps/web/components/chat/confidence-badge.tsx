import React from 'react'
import type { AnswerConfidence } from './types'

const CONFIDENCE_LABELS: Record<AnswerConfidence, string> = {
  high: 'Confianza alta',
  medium: 'Confianza media',
  low: 'Confianza baja',
  insufficient_evidence: 'Evidencia insuficiente',
}

const CONFIDENCE_STYLES: Record<AnswerConfidence, string> = {
  high: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  medium: 'border-blue-200 bg-blue-50 text-blue-800',
  low: 'border-amber-200 bg-amber-50 text-amber-800',
  insufficient_evidence: 'border-red-200 bg-red-50 text-red-800',
}

export function ConfidenceBadge({ confidence }: { confidence: AnswerConfidence }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLES[confidence]}`}
    >
      {CONFIDENCE_LABELS[confidence]}
    </span>
  )
}
