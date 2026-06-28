'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { StudySpec, StudyEndpoint, StudyVisit } from '@ichtys/ingestion'
import type { MedicalAnnotation } from '@ichtys/rag/medical-annotator'
import type { AnnotatedCriterion } from '../../app/(app)/studies/[id]/spec/page'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SpecReviewProps {
  specId: string
  studyId: string
  version: number
  status: 'draft' | 'approved' | 'superseded'
  extractionModel: string
  createdAt: string
  spec: StudySpec
  annotatedInclusion: AnnotatedCriterion[]
  annotatedExclusion: AnnotatedCriterion[]
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const SNOMED_URL = 'https://browser.ihtsdotools.org/?perspective=full&conceptId1='
const LOINC_URL  = 'https://loinc.org/'

const CONFIDENCE_CONFIG = {
  high:   { dot: 'bg-alphi-sage',  label: 'Alta',  ring: 'ring-alphi-sage/30'  },
  medium: { dot: 'bg-alphi-amber', label: 'Media', ring: 'ring-alphi-amber/30' },
  low:    { dot: 'bg-alphi-rose',  label: 'Baja',  ring: 'ring-alphi-rose/30'  },
}

const ENDPOINT_CONFIG = {
  primary:     { bg: 'bg-alphi-navy',  text: 'text-white',       label: 'Primario'     },
  secondary:   { bg: 'bg-alphi-teallit', text: 'text-alphi-teal', label: 'Secundario'   },
  exploratory: { bg: 'bg-amber-50',    text: 'text-alphi-amber', label: 'Exploratorio' },
}

const STATUS_CONFIG = {
  draft:      { bg: 'bg-amber-50 border-amber-200',  text: 'text-amber-700',  icon: '⚠', label: 'Borrador — Requiere revisión humana' },
  approved:   { bg: 'bg-emerald-50 border-emerald-200', text: 'text-alphi-sage', icon: '✓', label: 'Aprobado' },
  superseded: { bg: 'bg-alphi-slate border-alphi-border', text: 'text-alphi-muted', icon: '↩', label: 'Reemplazado por versión más reciente' },
}

/** Deduplicate annotations by code, keeping first occurrence. */
function dedupe(anns: MedicalAnnotation[]): MedicalAnnotation[] {
  const seen = new Set<string>()
  return anns.filter((a) => {
    if (seen.has(a.code)) return false
    seen.add(a.code)
    return true
  })
}

/** Build "Preguntar a ALPHI" URL for a criterion. */
function askAlphiUrl(studyId: string, text: string): string {
  const q = `Según el protocolo, explícame este criterio: "${text.slice(0, 200)}${text.length > 200 ? '…' : ''}"`
  return `/studies/${studyId}/chat?q=${encodeURIComponent(q)}`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConfidenceDot({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const { dot, label } = CONFIDENCE_CONFIG[confidence]
  return (
    <span
      title={`Confianza de extracción: ${label}`}
      className="flex items-center gap-1 text-xs text-alphi-muted"
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}

function SourcePagesBadge({ pages }: { pages: number[] }) {
  return (
    <span className="font-mono text-[10px] text-alphi-muted tracking-tight">
      p.{pages.join(',')}
    </span>
  )
}

function CodingChip({ annotation }: { annotation: MedicalAnnotation }) {
  const isSnomed = annotation.system === 'SNOMED-CT'
  const href = isSnomed
    ? `${SNOMED_URL}${annotation.code}`
    : `${LOINC_URL}${annotation.code}`
  const colorClass = isSnomed
    ? 'bg-alphi-teallit text-alphi-teal border-alphi-teal/20 hover:bg-alphi-teal/20'
    : 'bg-emerald-50 text-alphi-sage border-alphi-sage/20 hover:bg-alphi-sage/10'

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${annotation.system}: ${annotation.display}\n${annotation.code}`}
      className={[
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
        'text-[10px] font-medium transition-colors cursor-pointer',
        colorClass,
      ].join(' ')}
    >
      <span className="font-mono opacity-60">{annotation.system === 'SNOMED-CT' ? 'S' : 'L'}</span>
      <span className="max-w-[120px] truncate">{annotation.display}</span>
    </a>
  )
}

function CriteriaCard({
  criterion,
  studyId,
}: {
  criterion: AnnotatedCriterion
  studyId: string
}) {
  const [hovered, setHovered] = useState(false)
  const codes = dedupe(criterion.annotations)

  return (
    <li
      className={[
        'group relative rounded-lg border transition-all duration-150',
        hovered
          ? 'border-alphi-teal/40 bg-alphi-teallit/30 shadow-alphi-card'
          : 'border-alphi-border bg-white',
      ].join(' ')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex gap-3 px-4 py-3">
        {/* Criterion number */}
        <span className="shrink-0 mt-0.5 flex h-6 w-7 items-center justify-center rounded bg-alphi-slate font-mono text-[11px] font-semibold text-alphi-muted">
          {criterion.number}
        </span>

        <div className="flex-1 min-w-0 space-y-2">
          {/* Criterion text */}
          <p className="text-sm leading-relaxed text-alphi-navy">{criterion.text}</p>

          {/* SNOMED / LOINC chips */}
          {codes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {codes.map((ann) => (
                <CodingChip key={ann.code} annotation={ann} />
              ))}
            </div>
          )}

          {/* Metadata row */}
          <div className="flex items-center gap-3">
            <ConfidenceDot confidence={criterion.confidence} />
            <SourcePagesBadge pages={criterion.sourcePages} />
          </div>
        </div>

        {/* Ask ALPHI button — visible on hover */}
        <div
          className={[
            'shrink-0 self-center transition-opacity duration-150',
            hovered ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        >
          <Link
            href={askAlphiUrl(studyId, criterion.text)}
            className={[
              'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5',
              'text-xs font-semibold text-alphi-teal border border-alphi-teal/30',
              'bg-white hover:bg-alphi-teallit transition-colors whitespace-nowrap',
            ].join(' ')}
          >
            Preguntar a ALPHI
            <span className="text-[10px]">→</span>
          </Link>
        </div>
      </div>
    </li>
  )
}

function CriteriaSection({
  items,
  label,
  icon,
  studyId,
  borderColor,
}: {
  items: AnnotatedCriterion[]
  label: string
  icon: string
  studyId: string
  borderColor: string
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-alphi-border bg-alphi-slate px-4 py-6 text-center text-sm text-alphi-muted">
        Sin criterios extraídos para esta sección.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-2 border-l-2 pl-3 ${borderColor}`}>
        <span className="text-base leading-none">{icon}</span>
        <h3 className="text-sm font-bold text-alphi-navy">
          {label}
          <span className="ml-2 font-normal text-alphi-muted">({items.length})</span>
        </h3>
      </div>
      <ol className="space-y-2">
        {items.map((c, i) => (
          <CriteriaCard key={i} criterion={c} studyId={studyId} />
        ))}
      </ol>
    </div>
  )
}

function EndpointsTable({ endpoints }: { endpoints: StudyEndpoint[] }) {
  if (endpoints.length === 0) {
    return (
      <div className="rounded-lg border border-alphi-border bg-alphi-slate px-4 py-6 text-center text-sm text-alphi-muted">
        Sin endpoints extraídos.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-alphi-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-alphi-border bg-alphi-slate text-left">
            <th className="px-4 py-2.5 text-xs font-semibold text-alphi-muted uppercase tracking-wide w-28">Tipo</th>
            <th className="px-4 py-2.5 text-xs font-semibold text-alphi-muted uppercase tracking-wide">Objetivo</th>
            <th className="px-4 py-2.5 text-xs font-semibold text-alphi-muted uppercase tracking-wide">Criterio de valoración</th>
            <th className="px-4 py-2.5 text-xs font-semibold text-alphi-muted uppercase tracking-wide w-28">Fuente</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-alphi-border bg-white">
          {endpoints.map((e, i) => {
            const cfg = ENDPOINT_CONFIG[e.type]
            return (
              <tr key={i} className="align-top hover:bg-alphi-slate/50 transition-colors">
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
                    {cfg.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-alphi-navy leading-relaxed">{e.objective}</td>
                <td className="px-4 py-3 text-alphi-muted leading-relaxed">{e.endpoint}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <ConfidenceDot confidence={e.confidence} />
                    <SourcePagesBadge pages={e.sourcePages} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function VisitsTable({ visits }: { visits: StudyVisit[] }) {
  if (visits.length === 0) {
    return (
      <div className="rounded-lg border border-alphi-border bg-alphi-slate px-4 py-6 text-center text-sm text-alphi-muted">
        Sin visitas extraídas.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-alphi-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-alphi-border bg-alphi-slate text-left">
            <th className="px-4 py-2.5 text-xs font-semibold text-alphi-muted uppercase tracking-wide">Visita</th>
            <th className="px-4 py-2.5 text-xs font-semibold text-alphi-muted uppercase tracking-wide w-28">Etiqueta</th>
            <th className="px-4 py-2.5 text-xs font-semibold text-alphi-muted uppercase tracking-wide w-20">Día</th>
            <th className="px-4 py-2.5 text-xs font-semibold text-alphi-muted uppercase tracking-wide w-20">Ventana</th>
            <th className="px-4 py-2.5 text-xs font-semibold text-alphi-muted uppercase tracking-wide">Procedimientos</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-alphi-border bg-white">
          {visits.map((v, i) => (
            <tr key={i} className="align-top hover:bg-alphi-slate/50 transition-colors">
              <td className="px-4 py-3 font-semibold text-alphi-navy">{v.name}</td>
              <td className="px-4 py-3 text-alphi-muted">{v.label ?? <span className="text-alphi-border">—</span>}</td>
              <td className="px-4 py-3 font-mono text-alphi-muted">
                {v.day !== null && v.day !== undefined ? v.day : <span className="text-alphi-border">—</span>}
              </td>
              <td className="px-4 py-3 font-mono text-alphi-muted">
                {v.windowDays !== null && v.windowDays !== undefined ? `±${v.windowDays}d` : <span className="text-alphi-border">—</span>}
              </td>
              <td className="px-4 py-3">
                {v.procedures.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {v.procedures.map((p, j) => (
                      <span
                        key={j}
                        className="inline-block rounded bg-alphi-slate px-1.5 py-0.5 text-[11px] text-alphi-muted"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-alphi-border">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type Tab = 'eligibility' | 'endpoints' | 'visits'

export default function SpecReview({
  specId,
  studyId,
  version,
  status,
  extractionModel,
  createdAt,
  spec,
  annotatedInclusion,
  annotatedExclusion,
}: SpecReviewProps) {
  const [activeTab, setActiveTab] = useState<Tab>('eligibility')
  const [approving, setApproving]   = useState(false)
  const [approved, setApproved]     = useState(status === 'approved')

  const currentStatus: 'draft' | 'approved' | 'superseded' = approved ? 'approved' : status
  const statusCfg = STATUS_CONFIG[currentStatus]

  async function handleApprove() {
    setApproving(true)
    try {
      const res = await fetch(`/api/studies/${studyId}/spec/${specId}/approve`, { method: 'POST' })
      if (res.ok) setApproved(true)
    } finally {
      setApproving(false)
    }
  }

  const totalCriteria = annotatedInclusion.length + annotatedExclusion.length
  const totalCodes = new Set([
    ...annotatedInclusion.flatMap((c) => c.annotations.map((a) => a.code)),
    ...annotatedExclusion.flatMap((c) => c.annotations.map((a) => a.code)),
  ]).size

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'eligibility', label: 'Elegibilidad',  count: totalCriteria },
    { key: 'endpoints',   label: 'Endpoints',     count: spec.endpoints.length },
    { key: 'visits',      label: 'Visitas / SoA', count: spec.visits.length },
  ]

  return (
    <div className="space-y-5">

      {/* ── Status banner ── */}
      <div className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm ${statusCfg.bg} ${statusCfg.text}`}>
        <span className="font-mono text-base leading-none">{statusCfg.icon}</span>
        <span className="font-medium">{statusCfg.label}</span>
        {currentStatus === 'draft' && !approved && (
          <span className="ml-1 text-amber-600">
            — Revisa cada criterio y aprueba cuando el spec sea fiel al protocolo.
          </span>
        )}
      </div>

      {/* ── Protocol header ── */}
      <div className="flex items-start justify-between gap-4 rounded-xl border border-alphi-border bg-white px-5 py-4 shadow-alphi-card">
        <div className="space-y-1.5">
          {spec.identification.protocolCode && (
            <p className="font-mono text-xs font-semibold tracking-widest text-alphi-teal uppercase">
              {spec.identification.protocolCode}
            </p>
          )}
          {spec.identification.title ? (
            <p className="text-base font-semibold text-alphi-navy leading-snug max-w-2xl">
              {spec.identification.title}
            </p>
          ) : (
            <p className="text-sm text-alphi-muted italic">Título no identificado</p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-alphi-muted">
            {spec.identification.phase && (
              <span className="rounded-full border border-alphi-border px-2 py-0.5 font-semibold text-alphi-navy">
                Fase {spec.identification.phase}
              </span>
            )}
            <span>v{version}</span>
            <span>·</span>
            <span title="Modelo de extracción" className="font-mono">{extractionModel}</span>
            <span>·</span>
            <span>{new Date(createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            {totalCodes > 0 && (
              <>
                <span>·</span>
                <span className="text-alphi-teal font-semibold">
                  {totalCodes} código{totalCodes !== 1 ? 's' : ''} SNOMED/LOINC
                </span>
              </>
            )}
          </div>
        </div>

        {/* Approve button */}
        {currentStatus === 'draft' && (
          <button
            onClick={handleApprove}
            disabled={approving}
            className={[
              'shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150',
              'bg-alphi-navy text-white hover:bg-alphi-navydim shadow-alphi-card',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            ].join(' ')}
          >
            {approving ? 'Aprobando…' : '✓ Aprobar spec'}
          </button>
        )}
        {currentStatus === 'approved' && (
          <span className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-alphi-sage/30 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-alphi-sage">
            <span className="h-1.5 w-1.5 rounded-full bg-alphi-sage" />
            Aprobado
          </span>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div className="border-b border-alphi-border">
        <div className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={[
                'flex items-center gap-2 px-4 py-2.5 text-sm font-semibold',
                'border-b-2 -mb-px transition-all duration-150',
                activeTab === tab.key
                  ? 'border-alphi-teal text-alphi-teal'
                  : 'border-transparent text-alphi-muted hover:text-alphi-navy hover:border-alphi-border',
              ].join(' ')}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={[
                  'rounded-full px-1.5 py-0.5 text-xs font-bold',
                  activeTab === tab.key
                    ? 'bg-alphi-teal/10 text-alphi-teal'
                    : 'bg-alphi-slate text-alphi-muted',
                ].join(' ')}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="space-y-6">
        {activeTab === 'eligibility' && (
          <>
            {/* SNOMED summary bar */}
            {totalCodes > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-alphi-teal/20 bg-alphi-teallit/50 px-4 py-2.5">
                <span className="text-xs text-alphi-teal font-semibold">🔬 ALPHI detectó</span>
                <span className="text-xs text-alphi-teal">
                  {totalCodes} términos clínicos codificados (SNOMED-CT / LOINC) en los criterios.
                  Pasá el cursor sobre cada chip para ver el código y la fuente.
                </span>
              </div>
            )}

            <CriteriaSection
              items={annotatedInclusion}
              label="Criterios de inclusión"
              icon="✅"
              studyId={studyId}
              borderColor="border-alphi-sage"
            />
            <CriteriaSection
              items={annotatedExclusion}
              label="Criterios de exclusión"
              icon="🚫"
              studyId={studyId}
              borderColor="border-alphi-rose"
            />
          </>
        )}

        {activeTab === 'endpoints' && (
          <EndpointsTable endpoints={spec.endpoints} />
        )}

        {activeTab === 'visits' && (
          <VisitsTable visits={spec.visits} />
        )}
      </div>
    </div>
  )
}
