import React from 'react'
import { pageLabel, privatePdfDownloadHref } from './chat-api'
import type { Evidence } from './types'

export function EvidenceList({ evidences }: { evidences: Evidence[] }) {
  if (evidences.length === 0) return null

  return (
    <div className="mt-3 space-y-2" aria-label="Evidencias">
      {evidences.map((evidence) => (
        <EvidenceCard key={`${evidence.chunkId}-${evidence.documentVersionId}`} evidence={evidence} />
      ))}
    </div>
  )
}

export function EvidenceCard({ evidence }: { evidence: Evidence }) {
  const page = pageLabel(evidence.pageStart, evidence.pageEnd)

  return (
    <article className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        {evidence.documentName ? <span className="font-medium text-gray-800">{evidence.documentName}</span> : null}
        {page ? <span>{page}</span> : null}
        {evidence.sectionTitle ? <span>{evidence.sectionTitle}</span> : null}
      </div>
      <p
        className="mt-2 max-h-24 overflow-hidden text-sm leading-6 text-gray-800"
        data-full-excerpt={evidence.excerpt}
      >
        {evidence.excerpt}
      </p>
      {evidence.documentVersionId ? (
        <a
          className="mt-3 inline-flex text-sm font-medium text-blue-700 hover:text-blue-900"
          href={privatePdfDownloadHref(evidence.documentVersionId)}
          target="_blank"
          rel="noreferrer"
        >
          Abrir PDF fuente
        </a>
      ) : null}
    </article>
  )
}
