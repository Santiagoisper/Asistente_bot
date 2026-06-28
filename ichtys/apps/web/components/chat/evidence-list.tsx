'use client'

import React, { useState } from 'react'
import { pageLabel, privatePdfDownloadHref } from './chat-api'
import type { Evidence } from './types'

/** Renders [1][2] footnote superscripts inline in the answer text */
export function renderAnswerWithFootnotes(
  text: string,
  evidences: Evidence[],
  onFootnoteClick: (idx: number) => void,
): React.ReactNode[] {
  if (evidences.length === 0) return [<span key="t">{text}</span>]

  const parts: React.ReactNode[] = []
  let key = 0
  const pattern = /\[(\d+)\]/g
  let lastIndex = 0

  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  // biome-ignore lint: intentional assignment in condition
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1] ?? ''
    const num = parseInt(raw, 10)
    if (num >= 1 && num <= evidences.length) {
      if (match.index > lastIndex) {
        parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>)
      }
      parts.push(
        <button
          key={key++}
          type="button"
          className="alphi-footnote"
          onClick={() => onFootnoteClick(num - 1)}
          title={`Ver fuente ${num}`}
        >
          {num}
        </button>,
      )
      lastIndex = match.index + match[0].length
    }
  }
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>)
  }

  return parts.length > 0 ? parts : [<span key="t">{text}</span>]
}

/* ── EvidenceCard ──────────────────────────────────────────────────────── */

export function EvidenceCard({
  evidence,
  index = 1,
  highlighted = false,
  onOpenViewer,
}: {
  evidence: Evidence
  index?: number
  highlighted?: boolean
  onOpenViewer?: (e: Evidence) => Promise<void>
}) {
  const label = pageLabel(evidence.pageStart, evidence.pageEnd)
  const downloadHref = privatePdfDownloadHref(evidence.documentVersionId)
  const isLong = evidence.excerpt.length > 300

  return (
    <div
      id={`evidence-${index - 1}`}
      className={[
        'rounded-xl border px-4 py-3 text-sm transition-all duration-200',
        highlighted
          ? 'border-alphi-teal/60 bg-alphi-teal/5 shadow-alphi-card'
          : 'border-alphi-border bg-white',
      ].join(' ')}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-alphi-navy text-[10px] font-bold text-white">
            {index}
          </span>
          <span className="truncate text-xs font-semibold text-alphi-navy">
            {evidence.documentName ?? 'Documento'}
          </span>
        </div>
        {label && (
          <span className="shrink-0 rounded bg-alphi-slate px-1.5 py-0.5 font-mono text-[10px] text-alphi-muted">
            {label}
          </span>
        )}
      </div>

      {evidence.sectionTitle && (
        <p className="mb-1 text-[11px] font-medium text-alphi-teal">{evidence.sectionTitle}</p>
      )}

      <p
        className={['text-[12px] leading-relaxed text-alphi-navy/80 italic', isLong ? 'max-h-24 overflow-hidden' : ''].join(' ')}
        data-full-excerpt={evidence.excerpt}
      >
        &ldquo;{evidence.excerpt}&rdquo;
      </p>

      <div className="mt-2 flex gap-2">
        {evidence.pageStart !== null && onOpenViewer && (
          <button
            type="button"
            className="alphi-btn-ghost text-[10px] px-2 py-0.5"
            onClick={() => void onOpenViewer(evidence)}
          >
            Ver en documento
          </button>
        )}
        <a
          href={downloadHref}
          target="_blank"
          rel="noreferrer"
          className="alphi-btn-ghost text-[10px] px-2 py-0.5"
        >
          Descargar &rarr;
        </a>
      </div>
    </div>
  )
}

/* ── EvidenceList ──────────────────────────────────────────────────────── */

export function EvidenceList({
  evidences,
  highlightIndex,
}: {
  evidences: Evidence[]
  highlightIndex?: number | null
}) {
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const [viewerTitle, setViewerTitle] = useState<string>('')
  const [viewerExcerpt, setViewerExcerpt] = useState<string>('')

  if (evidences.length === 0) return null

  async function openInlineViewer(evidence: Evidence): Promise<void> {
    if (evidence.pageStart === null || evidence.pageStart === undefined) return
    try {
      const res = await fetch(
        `/api/documents/${encodeURIComponent(evidence.documentId)}/page/${evidence.pageStart}`,
      )
      if (!res.ok) return
      const payload = (await res.json()) as { openUrl?: string }
      if (!payload.openUrl) return
      setViewerTitle(evidence.documentName ?? 'Documento')
      setViewerExcerpt(evidence.excerpt)
      setViewerUrl(payload.openUrl)
    } catch {
      // non-blocking
    }
  }

  return (
    <>
      <div className="mt-4 space-y-2" aria-label="Fuentes citadas">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-alphi-muted">
          Fuentes citadas
        </p>
        {evidences.map((evidence, idx) => (
          <EvidenceCard
            key={`${evidence.chunkId}-${evidence.documentVersionId}`}
            evidence={evidence}
            index={idx + 1}
            highlighted={highlightIndex === idx}
            onOpenViewer={openInlineViewer}
          />
        ))}
      </div>

      {viewerUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-alphi-navy/70 p-4 backdrop-blur-sm">
          <div className="animate-slide-up flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-alphi-modal">
            <div className="flex items-center justify-between border-b border-alphi-border px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-alphi-navy">{viewerTitle}</p>
                <p className="mt-0.5 truncate text-xs text-alphi-muted">{viewerExcerpt}</p>
              </div>
              <button
                type="button"
                className="alphi-btn-secondary ml-4 shrink-0"
                onClick={() => setViewerUrl(null)}
              >
                Cerrar
              </button>
            </div>
            <iframe
              title="Visor de evidencia ALPHI"
              src={viewerUrl}
              className="h-full w-full"
            />
          </div>
        </div>
      ) : null}
    </>
  )
}
