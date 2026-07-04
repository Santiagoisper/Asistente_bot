'use client'

import { MarketingShell } from '../../../components/marketing/marketing-shell'
import { useMemo, useState } from 'react'

/** Constantes documentadas en docs/evals/demo-metrics.md */
const DEFAULT_MANUAL_MIN = 8
const DEFAULT_ASSISTANT_SEC = 45
const DEFAULT_CRC_HOURLY_USD = 25

export default function RoiPage() {
  const [studies, setStudies] = useState(3)
  const [queriesPerMonth, setQueriesPerMonth] = useState(120)
  const [manualMin, setManualMin] = useState(DEFAULT_MANUAL_MIN)
  const [assistantSec, setAssistantSec] = useState(DEFAULT_ASSISTANT_SEC)
  const [hourlyUsd, setHourlyUsd] = useState(DEFAULT_CRC_HOURLY_USD)

  const metrics = useMemo(() => {
    const assistantMin = assistantSec / 60
    const savedMinPerQuery = Math.max(0, manualMin - assistantMin)
    const hoursSavedMonth = (studies * queriesPerMonth * savedMinPerQuery) / 60
    const usdSavedMonth = hoursSavedMonth * hourlyUsd
    const usdSavedYear = usdSavedMonth * 12
    return { savedMinPerQuery, hoursSavedMonth, usdSavedMonth, usdSavedYear }
  }, [studies, queriesPerMonth, manualMin, assistantSec, hourlyUsd])

  return (
    <MarketingShell
      eyebrow="Valor"
      title="Calculadora de ROI"
      description="Estimación operacional para sitios de ensayo. Basada en supuestos internos — no resultados clínicos ni de ensayos reales."
    >
      <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-alphi-navy/90">
        <strong>Disclaimer:</strong> números ilustrativos para conversación comercial. Ajustá los
        sliders a tu operación. Pass rate y latencia reales del RAG se documentan en eval interna
        mock (ver Trust Center / due diligence).
      </div>

      <div className="space-y-8 rounded-lg border border-alphi-border bg-white p-6">
        <SliderField
          label="Estudios activos"
          value={studies}
          min={1}
          max={20}
          onChange={setStudies}
        />
        <SliderField
          label="Consultas de protocolo / mes / estudio"
          value={queriesPerMonth}
          min={10}
          max={500}
          step={10}
          onChange={setQueriesPerMonth}
        />
        <SliderField
          label="Minutos búsqueda manual (PDF 200+ págs)"
          value={manualMin}
          min={5}
          max={15}
          onChange={setManualMin}
        />
        <SliderField
          label="Segundos respuesta Ichtys (con cita)"
          value={assistantSec}
          min={20}
          max={120}
          step={5}
          onChange={setAssistantSec}
        />
        <SliderField
          label="Costo hora CRC (USD, referencia LATAM)"
          value={hourlyUsd}
          min={15}
          max={60}
          onChange={setHourlyUsd}
        />
      </div>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <MetricCard
          label="Ahorro por consulta"
          value={`${metrics.savedMinPerQuery.toFixed(1)} min`}
        />
        <MetricCard
          label="Horas ahorradas / mes"
          value={metrics.hoursSavedMonth.toFixed(1)}
        />
        <MetricCard
          label="Ahorro estimado / mes"
          value={`USD ${metrics.usdSavedMonth.toFixed(0)}`}
          highlight
        />
        <MetricCard
          label="Ahorro estimado / año"
          value={`USD ${metrics.usdSavedYear.toFixed(0)}`}
          highlight
        />
      </section>

      <p className="mt-8 text-xs leading-relaxed text-alphi-muted">
        Fórmula: (min manual − seg asistente/60) × estudios × consultas/mes ÷ 60 × costo hora.
        Supuestos: PRD §2 (dolor operacional en sala), eval mock T2D para calidad RAG. No incluye
        reducción de findings de monitor ni tiempo de extracción de spec — contactar para modelo
        ampliado bajo NDA.
      </p>
    </MarketingShell>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="mb-2 flex justify-between text-sm">
        <span className="font-medium text-alphi-navy">{label}</span>
        <span className="font-semibold text-alphi-teal">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-alphi-teal"
      />
    </div>
  )
}

function MetricCard({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-5 ${
        highlight ? 'border-alphi-teal bg-alphi-teal/5' : 'border-alphi-border bg-white'
      }`}
    >
      <p className="text-xs text-alphi-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-alphi-navy">{value}</p>
    </div>
  )
}
