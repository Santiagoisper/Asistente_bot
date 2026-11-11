'use client'

import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Evidence } from './types'
import { citationEvidencePosition, hasVerifiableCitationIndices } from './citation-index'

type AnswerContentProps = {
  text: string
  evidences: Evidence[]
  onFootnoteClick: (idx: number) => void
}

/** Convierte [n] en links internos para que react-markdown los renderice como botones. */
export function prepareAnswerMarkdown(text: string, evidences: Evidence[]): string {
  if (!hasVerifiableCitationIndices(evidences)) return text
  return text.replace(/\[(\d+)\]/g, (_, raw: string) => {
    const num = parseInt(raw, 10)
    if (citationEvidencePosition(evidences, num) !== null) return `[${num}](#alphi-fn-${num})`
    return `[${raw}]`
  })
}

export function AnswerContent({ text, evidences, onFootnoteClick }: AnswerContentProps) {
  const markdown = prepareAnswerMarkdown(text, evidences)
  const unverifiable = evidences.length > 0 && !hasVerifiableCitationIndices(evidences)

  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('#alphi-fn-')) {
              const raw = href.slice('#alphi-fn-'.length)
              const num = /^\d+$/.test(raw) ? Number(raw) : NaN
              const position = citationEvidencePosition(evidences, num)
              if (position !== null) {
                return (
                  <button
                    type="button"
                    className="alphi-footnote"
                    onClick={() => onFootnoteClick(position)}
                    title={`Ver fuente ${num}`}
                  >
                    {children}
                  </button>
                )
              }
              return <span>{children}</span>
            }
            if (/^\[?\d+\]?$/.test(String(children))) return <span>{children}</span>
            return (
              <a href={href} target="_blank" rel="noreferrer" className="text-alphi-teal underline">
                {children}
              </a>
            )
          },
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-alphi-border">
              <table className="min-w-full text-left text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-alphi-slate text-alphi-navy">{children}</thead>,
          th: ({ children }) => <th className="border-b border-alphi-border px-3 py-2 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-b border-alphi-border px-3 py-2 align-top">{children}</td>,
          tr: ({ children }) => <tr className="last:[&>td]:border-b-0">{children}</tr>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-alphi-navy">{children}</strong>,
          h3: ({ children }) => <h3 className="mb-2 mt-3 text-base font-semibold text-alphi-navy">{children}</h3>,
          h4: ({ children }) => <h4 className="mb-1.5 mt-2 text-sm font-semibold text-alphi-navy">{children}</h4>,
          hr: () => <hr className="my-3 border-alphi-border" />,
        }}
      >
        {markdown}
      </ReactMarkdown>
      {unverifiable && (
        <p role="note" className="mt-2 text-xs text-alphi-muted">
          Numeración no verificable en esta respuesta anterior. Las fuentes se muestran sin enlaces numéricos.
        </p>
      )}
    </>
  )
}
