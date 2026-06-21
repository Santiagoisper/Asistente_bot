'use client'

import { useState } from 'react'
import type { StudySpec, EligibilityCriterion, StudyEndpoint, StudyVisit } from '@ichtys/ingestion'

interface SpecReviewProps {
  specId: string
  studyId: string
  version: number
  status: 'draft' | 'approved' | 'superseded'
  extractionModel: string
  createdAt: string
  spec: StudySpec
}

const CONFIDENCE_COLORS = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-red-100 text-red-800',
}

const ENDPOINT_TYPE_LABELS = {
  primary: 'Primario',
  secondary: 'Secundario',
  exploratory: 'Exploratorio',
}

const STATUS_LABELS = {
  draft: 'Borrador',
  approved: 'Aprobado',
  superseded: 'Reemplazado',
}

const STATUS_COLORS = {
  draft: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  superseded: 'bg-gray-100 text-gray-600',
}

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${CONFIDENCE_COLORS[confidence]}`}>
      {confidence}
    </span>
  )
}

function SourcePages({ pages }: { pages: number[] }) {
  return (
    <span className="text-xs text-gray-400">
      p. {pages.join(', ')}
    </span>
  )
}

function CriteriaList({ items, label }: { items: EligibilityCriterion[]; label: string }) {
  if (items.length === 0) return <p className="text-sm text-gray-400">Sin criterios extraídos.</p>
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">{label} ({items.length})</h3>
      <ol className="space-y-2">
        {items.map((c, i) => (
          <li key={i} className="flex gap-3 rounded border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
            <span className="shrink-0 font-mono text-gray-500 text-xs pt-0.5">{c.number}.</span>
            <div className="flex-1 space-y-1">
              <p className="text-gray-800 leading-relaxed">{c.text}</p>
              <div className="flex items-center gap-2">
                <ConfidenceBadge confidence={c.confidence} />
                <SourcePages pages={c.sourcePages} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function EndpointsTable({ endpoints }: { endpoints: StudyEndpoint[] }) {
  if (endpoints.length === 0) return <p className="text-sm text-gray-400">Sin endpoints extraídos.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs font-medium text-gray-500">
            <th className="pb-2 pr-3 w-24">Tipo</th>
            <th className="pb-2 pr-3">Objetivo</th>
            <th className="pb-2 pr-3">Criterio de valoración</th>
            <th className="pb-2 w-20">Fuente</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {endpoints.map((e, i) => (
            <tr key={i} className="align-top">
              <td className="py-2 pr-3">
                <span className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                  {ENDPOINT_TYPE_LABELS[e.type]}
                </span>
              </td>
              <td className="py-2 pr-3 text-gray-700 leading-relaxed">{e.objective}</td>
              <td className="py-2 pr-3 text-gray-600 leading-relaxed">{e.endpoint}</td>
              <td className="py-2">
                <div className="flex flex-col gap-1">
                  <ConfidenceBadge confidence={e.confidence} />
                  <SourcePages pages={e.sourcePages} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VisitsTable({ visits }: { visits: StudyVisit[] }) {
  if (visits.length === 0) return <p className="text-sm text-gray-400">Sin visitas extraídas.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs font-medium text-gray-500">
            <th className="pb-2 pr-3">Visita</th>
            <th className="pb-2 pr-3 w-24">Etiqueta</th>
            <th className="pb-2 pr-3 w-20">Día</th>
            <th className="pb-2 pr-3 w-20">Ventana</th>
            <th className="pb-2">Procedimientos</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {visits.map((v, i) => (
            <tr key={i} className="align-top">
              <td className="py-2 pr-3 font-medium text-gray-800">{v.name}</td>
              <td className="py-2 pr-3 text-gray-500">{v.label ?? '—'}</td>
              <td className="py-2 pr-3 text-gray-500 font-mono">{v.day ?? '—'}</td>
              <td className="py-2 pr-3 text-gray-500 font-mono">
                {v.windowDays !== null && v.windowDays !== undefined ? `±${v.windowDays}d` : '—'}
              </td>
              <td className="py-2 text-gray-600 text-xs leading-relaxed">
                {v.procedures.length > 0 ? v.procedures.join(' · ') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type Tab = 'eligibility' | 'endpoints' | 'visits'

export default function SpecReview({ specId, studyId, version, status, extractionModel, createdAt, spec }: SpecReviewProps) {
  const [activeTab, setActiveTab] = useState<Tab>('eligibility')
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(status === 'approved')

  async function handleApprove() {
    setApproving(true)
    try {
      const res = await fetch(`/api/studies/${studyId}/spec/${specId}/approve`, { method: 'POST' })
      if (res.ok) setApproved(true)
    } finally {
      setApproving(false)
    }
  }

  const TABS: { key: Tab; label: string; count: number }[] = [
    {
      key: 'eligibility',
      label: 'Elegibilidad',
      count: spec.inclusionCriteria.length + spec.exclusionCriteria.length,
    },
    { key: 'endpoints', label: 'Endpoints', count: spec.endpoints.length },
    { key: 'visits', label: 'Visitas', count: spec.visits.length },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          {spec.identification.protocolCode && (
            <p className="text-xs font-mono text-gray-500">{spec.identification.protocolCode}</p>
          )}
          {spec.identification.title && (
            <p className="text-sm text-gray-700">{spec.identification.title}</p>
          )}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>v{version}</span>
            <span>·</span>
            <span>{spec.identification.phase ?? 'fase no especificada'}</span>
            <span>·</span>
            <span>modelo: {extractionModel}</span>
            <span>·</span>
            <span>{new Date(createdAt).toLocaleDateString('es-AR')}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[approved ? 'approved' : status]}`}>
            {STATUS_LABELS[approved ? 'approved' : status]}
          </span>
          {!approved && status === 'draft' && (
            <button
              onClick={handleApprove}
              disabled={approving}
              className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {approving ? 'Aprobando…' : 'Aprobar spec'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div>
        <div className="flex gap-1 border-b mb-4">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.key
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'eligibility' && (
          <div className="space-y-6">
            <CriteriaList items={spec.inclusionCriteria} label="Criterios de inclusión" />
            <CriteriaList items={spec.exclusionCriteria} label="Criterios de exclusión" />
          </div>
        )}
        {activeTab === 'endpoints' && <EndpointsTable endpoints={spec.endpoints} />}
        {activeTab === 'visits' && <VisitsTable visits={spec.visits} />}
      </div>
    </div>
  )
}
