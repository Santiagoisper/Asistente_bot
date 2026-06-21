'use client'

import React, { useState } from 'react'
import { pageLabel, privatePdfInlineHref } from './chat-api'
import type { Evidence } from './types'

export function EvidenceList({ evidences }: { evidences: Evidence[] }) {
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const [viewerTitle, setViewerTitle] = useState<string>('')
  const [viewerExcerpt, setViewerExcerpt] = useState<string>('')

  if (evidences.length === 0) return null

  async function openInlineViewer(evidence: Evidence): Promise<void> {
    if (evidence.pageStart === null || evidence.pageStart === undefined) return
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(evidence.documentId)}/page/${evidence.pageStart}`)
      if (!response.ok) return
      const payload = (await response.json()) as { openUrl?: string }
      if (!payload.openUrl) return
      setViewerTitle(evidence.documentName ?? 'Documento')
      setViewerExcerpt(evidence.excerpt)
      setViewerUrl(payload.openUrl)
    } catch {
      // non-blocking UI path
    }
  }

  return (
    <>
      <div className="mt-3 space-y-2" aria-label="Evidencias">
        {evidences.map((evidence) => (
          <EvidenceCard
            key={`${evidence.chunkId}-${evidence.documentVersionId}`}
            evidence={evidence}
            onOpenViewer={openInlineViewer}
          />
        ))}
      </div>

      {viewerUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{viewerTitle}</p>
                <p className="line-clamp-1 text-xs text-gray-500">{viewerExcerpt}</p>
              </div>
              <button
                type="button"
                className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => setViewerUrl(null)}
              >
                Cerrar
              </button>
            </div>
            <iframe
              title="Visor de evidencia"
              src={viewerUrl}
              className="h-full w-full"
            />
          </div>
        </div>
      ) : null}
    </>
  )
}

export function EvidenceCard({ evidence, onOpenViewer }: { evidence: Evidence; onOpenViewer?: (e: Evidence) => Promise<void> }) {
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
        <div className="mt-3 flex flex-wrap gap-3">
          <a
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-900"
            href={privatePdfInlineHref(evidence.documentVersionId, evidence.pageStart)}
            target="_blank"
            rel="noreferrer"
          >
            Abrir en PDF
            {evidence.pageStart !== null && evidence.pageStart !== undefined && (
              <span className="text-xs text-blue-500">· p. {evidence.pageStart}</span>
            )}
          </a>
          {evidence.pageStart !== null && evidence.pageStart !== undefined ? (
            <button
              type="button"
              className="text-sm font-medium text-gray-700 underline hover:text-gray-900"
              onClick={() => {
                if (onOpenViewer) {
                  void onOpenViewer(evidence)
                }
              }}
            >
              Abrir visor
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
