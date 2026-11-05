'use client'

import { useEffect, useRef, useState } from 'react'
import { quoteParts } from '../../lib/cabina/origen'

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F5E73]'

export function OrigenPanel({
  visitLabel,
  procedureLabel,
  page,
  quote,
  highlights,
  howRead,
  sourceLabel,
  low,
  reviewed,
  modal,
  onClose,
  onDoubt,
  onSaveQuote,
}: {
  visitLabel: string
  procedureLabel: string
  page: number
  quote: string
  highlights: string[]
  howRead: string
  sourceLabel: string
  low: boolean
  reviewed: boolean
  modal: boolean
  onClose: () => void
  onDoubt: () => void
  onSaveQuote: (quote: string) => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const quoteRef = useRef<HTMLQuoteElement>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(quote)
  const [pageOpen, setPageOpen] = useState(false)
  const parts = quoteParts(quote, highlights)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const root = panelRef.current
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (!modal || event.key !== 'Tab' || !root) return
      const items = [...root.querySelectorAll<HTMLElement>('button, textarea, input, select, a[href]')].filter(
        (node) => !node.hasAttribute('disabled'),
      )
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      const outside = !(active instanceof Node) || !root.contains(active)
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, onClose])

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-modal={modal}
      aria-labelledby="origen-title"
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col gap-3 overflow-y-auto rounded-t-2xl border border-alphi-border bg-white p-5 shadow-alphi-modal md:inset-x-auto md:bottom-4 md:right-4 md:top-20 md:max-h-[calc(100vh-6rem)] md:w-[400px] md:rounded-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-alphi-muted">{visitLabel}</p>
          <h2 id="origen-title" className="text-lg font-semibold">
            {procedureLabel}
          </h2>
        </div>
        <button ref={closeRef} type="button" className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-[#0F5E73] ${focusRing}`} onClick={onClose}>
          Cerrar
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-11 items-center rounded-md bg-[#E2F0F4] px-2 font-mono text-xs font-medium text-[#0A4455]">p. {page}</span>
        <span className="inline-flex min-h-11 items-center rounded-full bg-[#E2F0F4] px-3 text-xs font-semibold text-[#0A4455]">{sourceLabel}</span>
        <span className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold ${low && !reviewed ? 'bg-[#FFF1D6] text-[#6B4200]' : 'bg-[#DDF0E6] text-[#0E4D33]'}`}>
          {low && reviewed ? 'Certeza baja · revisada' : low ? 'Certeza baja' : 'Certeza alta'}
        </span>
      </div>
      <div>
        <p className="mb-1 text-xs text-alphi-muted">Lo que dice el protocolo, palabra por palabra</p>
        <blockquote ref={quoteRef} tabIndex={-1} className="rounded-r-xl border-l-4 border-[#0F5E73] bg-alphi-slate px-4 py-3 text-sm leading-relaxed outline-none">
          «
          {parts.map((part, index) =>
            part.hit ? (
              <mark key={`${index}-${part.text}`} className="bg-[#FFE7A8] text-inherit">
                {part.text}
              </mark>
            ) : (
              <span key={`${index}-plain`}>{part.text}</span>
            ),
          )}
          »
          <span className="mt-2 block text-xs text-alphi-muted">Texto ficticio de ejemplo · {sourceLabel}, p. {page}</span>
        </blockquote>
      </div>
      <div>
        <p className="mb-1 text-xs text-alphi-muted">Cómo se leyó esta casilla</p>
        <p className="text-sm leading-relaxed">{howRead}</p>
      </div>
      {pageOpen ? (
        <p className="rounded-xl bg-alphi-slate px-3 py-3 text-sm" role="status">
          Página {page}. En esta demo la cita de arriba es el texto de esa página. No hay un archivo para abrir.
        </p>
      ) : null}
      {editing ? (
        <label className="block text-sm font-semibold" htmlFor="origen-correccion">
          Corrección en esta demo
          <textarea id="origen-correccion" className={`mt-1 min-h-28 w-full rounded-lg border border-alphi-border px-3 py-2 text-base ${focusRing}`} value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`inline-flex min-h-11 items-center rounded-lg bg-[#0F5E73] px-3 text-sm font-semibold text-white ${focusRing}`} onClick={() => { setPageOpen(true); quoteRef.current?.focus() }}>
          Abrir página
        </button>
        <button
          type="button"
          className={`inline-flex min-h-11 items-center rounded-lg border-[1.5px] border-[#0F5E73] px-3 text-sm font-semibold text-[#0A4455] ${focusRing}`}
          onClick={() => {
            if (!editing) {
              setDraft(quote)
              setEditing(true)
              return
            }
            onSaveQuote(draft)
            setEditing(false)
          }}
        >
          {editing ? 'Guardar corrección' : 'Corregir'}
        </button>
        <button type="button" className={`inline-flex min-h-11 items-center rounded-lg border-[1.5px] border-[#B7791F] px-3 text-sm font-semibold text-[#6B4200] ${focusRing}`} onClick={onDoubt}>
          Marcar como duda
        </button>
      </div>
    </aside>
  )
}
