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

/**
 * Construye un regex tolerante a espacios a partir del pasaje citado, para
 * localizarlo dentro del texto de la página aunque difieran los saltos de línea.
 */
function buildExcerptRegex(excerpt: string): RegExp | null {
  const cleaned = excerpt
    .replace(/^\s*…\s*/, '')
    .replace(/\s*…\s*$/, '')
    .trim()
    .replace(/\s+/g, ' ')
  if (cleaned.length < 8) return null
  const needle = cleaned.slice(0, 240)
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  try {
    return new RegExp(escaped, 'i')
  } catch {
    return null
  }
}

/** Renderiza el texto de la página con el pasaje citado resaltado (<mark>). */
function HighlightedPageText({ pageText, excerpt }: { pageText: string; excerpt: string }) {
  const markRef = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    markRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [pageText, excerpt])

  if (!pageText) {
    return (
      <p className="text-xs text-alphi-muted">
        No hay texto extraído disponible para esta página.
      </p>
    )
  }

  const regex = buildExcerptRegex(excerpt)
  const match = regex ? regex.exec(pageText) : null

  if (!match) {
    // Sin match exacto: mostramos el texto completo sin resaltar (el pasaje
    // citado se ve igual arriba del visor).
    return <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-alphi-navy/80">{pageText}</p>
  }

  const before = pageText.slice(0, match.index)
  const hit = pageText.slice(match.index, match.index + match[0].length)
  const after = pageText.slice(match.index + match[0].length)

  return (
    <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-alphi-navy/80">
      {before}
      <span ref={markRef} className="rounded bg-alphi-amber/30 px-0.5 font-medium text-alphi-navy">
        {hit}
      </span>
      {after}
    </p>
  )
}

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
  const [viewerPageText, setViewerPageText] = useState<string>('')
  const [viewerPage, setViewerPage] = useState<number | null>(null)
  const [viewerLoading, setViewerLoading] = useState(false)

  if (evidences.length === 0) return null

  async function openInlineViewer(evidence: Evidence): Promise<void> {
    const start = evidence.pageStart
    if (start === null || start === undefined) return
    const end = evidence.pageEnd ?? start
    setViewerLoading(true)
    setViewerTitle(evidence.documentName ?? 'Documento')
    setViewerExcerpt(evidence.excerpt)
    setViewerPage(start)
    setViewerPageText('')
    setViewerUrl(null)

    // En chunks multi-página el pasaje citado puede estar en cualquier página
    // del rango [pageStart, pageEnd]. Recorremos el rango y elegimos la primera
    // página cuyo texto contiene el excerpt; si ninguna coincide, usamos la
    // primera página disponible.
    const regex = buildExcerptRegex(evidence.excerpt)
    const lastPage = Math.min(end, start + 4)
    type PageHit = { openUrl: string; pageText: string; page: number }
    let firstOk: PageHit | null = null
    let matched: PageHit | null = null

    try {
      for (let p = start; p <= lastPage && !matched; p++) {
        const res = await fetch(
          `/api/documents/${encodeURIComponent(evidence.documentId)}/page/${p}`,
        )
        if (!res.ok) continue
        const payload = (await res.json()) as { openUrl?: string; pageText?: string }
        if (!payload.openUrl) continue
        const hit: PageHit = { openUrl: payload.openUrl, pageText: payload.pageText ?? '', page: p }
        if (!firstOk) firstOk = hit
        if (regex && hit.pageText && regex.test(hit.pageText)) matched = hit
      }
      const pick = matched ?? firstOk
      if (pick) {
        setViewerPage(pick.page)
        setViewerPageText(pick.pageText)
        setViewerUrl(pick.openUrl)
      }
    } catch {
      // non-blocking
    } finally {
      setViewerLoading(false)
    }
  }

  function closeViewer(): void {
    setViewerUrl(null)
    setViewerPageText('')
    setViewerPage(null)
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
          <div className="animate-slide-up flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-alphi-modal">
            <div className="flex items-center justify-between border-b border-alphi-border px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-alphi-navy">
                  {viewerTitle}
                  {viewerPage !== null && (
                    <span className="ml-2 rounded bg-alphi-slate px-1.5 py-0.5 font-mono text-[10px] text-alphi-muted">
                      p. {viewerPage}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-alphi-muted">
                  Pasaje citado resaltado sobre el texto de la página
                </p>
              </div>
              <button
                type="button"
                className="alphi-btn-secondary ml-4 shrink-0"
                onClick={closeViewer}
              >
                Cerrar
              </button>
            </div>

            {/* Dos paneles: PDF a la izquierda, texto resaltado a la derecha */}
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <iframe
                title="Visor de evidencia ALPHI"
                src={viewerUrl}
                className="h-1/2 w-full border-b border-alphi-border lg:h-full lg:w-1/2 lg:border-b-0 lg:border-r"
              />
              <div className="h-1/2 w-full overflow-y-auto bg-alphi-slate/40 px-5 py-4 lg:h-full lg:w-1/2">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-alphi-muted">
                  Texto de la página {viewerPage}
                </p>
                {viewerLoading ? (
                  <p className="text-xs text-alphi-muted">Cargando texto de la página...</p>
                ) : (
                  <HighlightedPageText pageText={viewerPageText} excerpt={viewerExcerpt} />
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
