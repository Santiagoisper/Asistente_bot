import React from 'react'
import type { AnswerConfidence } from './types'

const CONFIG: Record<AnswerConfidence, { label: string; badgeClass: string; dotClass: string }> = {
  high: {
    label: 'Confianza alta',
    badgeClass: 'border-alphi-sage/30 bg-alphi-sage/10 text-alphi-sage',
    dotClass: 'bg-alphi-sage',
  },
  medium: {
    label: 'Confianza media',
    badgeClass: 'border-alphi-teal/30 bg-alphi-teal/10 text-alphi-teal',
    dotClass: 'bg-alphi-teal',
  },
  low: {
    label: 'Confianza baja',
    badgeClass: 'border-alphi-amber/30 bg-alphi-amber/10 text-alphi-amber',
    dotClass: 'bg-alphi-amber',
  },
  insufficient_evidence: {
    label: 'Evidencia insuficiente',
    badgeClass: 'border-alphi-rose/30 bg-alphi-rose/10 text-alphi-rose',
    dotClass: 'bg-alphi-rose',
  },
}

export function ConfidenceBadge({ confidence }: { confidence: AnswerConfidence }) {
  const cfg = CONFIG[confidence]
  return (
    <span className={['inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium', cfg.badgeClass].join(' ')}>
      <span className={['h-1.5 w-1.5 rounded-full', cfg.dotClass].join(' ')} />
      {cfg.label}
    </span>
  )
}
