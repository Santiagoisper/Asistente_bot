'use client'

import { compatWindowDays, normalizeVisitWindow } from '@ichtys/clinical'
import { formatVisitWindow } from '@ichtys/ingestion/visit-window-format'

export function parseWindowSide(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return 'invalid'
  return Number(trimmed)
}

export function windowDraftFromVisit(visit: {
  windowDays?: number | null
  windowBefore?: number | null
  windowAfter?: number | null
}): { before: string; after: string } {
  const window = normalizeVisitWindow(visit)
  return {
    before: window.before === null ? '' : String(window.before),
    after: window.after === null ? '' : String(window.after),
  }
}

export function visitWindowFromDraft(
  beforeRaw: string,
  afterRaw: string,
):
  | { ok: true; windowBefore: number | null; windowAfter: number | null; windowDays: number | null }
  | { ok: false; error: string } {
  const windowBefore = parseWindowSide(beforeRaw)
  const windowAfter = parseWindowSide(afterRaw)
  if (windowBefore === 'invalid' || windowAfter === 'invalid') {
    return { ok: false, error: 'La ventana debe ser un entero ≥ 0.' }
  }
  return {
    ok: true,
    windowBefore,
    windowAfter,
    windowDays: compatWindowDays({ windowBefore, windowAfter }),
  }
}

export function VisitWindowFields({
  before,
  after,
  disabled,
  onChange,
}: {
  before: string
  after: string
  disabled?: boolean
  onChange: (next: { before: string; after: string }) => void
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-alphi-muted">Ventana (días)</p>
      <div className="flex items-center gap-2">
        <label className="flex-1 text-[10px] uppercase tracking-wide text-alphi-muted">
          antes
          <input
            aria-label="Ventana antes"
            type="number"
            min={0}
            value={before}
            disabled={disabled}
            placeholder="2"
            onChange={(e) => onChange({ before: e.target.value, after })}
            className="mt-1 w-full rounded-md border border-alphi-border bg-white px-3 py-1.5 font-mono text-sm text-alphi-navy focus:border-alphi-teal focus:outline-none"
          />
        </label>
        <label className="flex-1 text-[10px] uppercase tracking-wide text-alphi-muted">
          después
          <input
            aria-label="Ventana después"
            type="number"
            min={0}
            value={after}
            disabled={disabled}
            placeholder="3"
            onChange={(e) => onChange({ before, after: e.target.value })}
            className="mt-1 w-full rounded-md border border-alphi-border bg-white px-3 py-1.5 font-mono text-sm text-alphi-navy focus:border-alphi-teal focus:outline-none"
          />
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const value = before.trim() !== '' ? before : after
            onChange({ before: value, after: value })
          }}
          className="mt-4 shrink-0 rounded-md border border-alphi-border bg-white px-2 py-1.5 text-xs font-semibold text-alphi-navy hover:bg-alphi-slate disabled:opacity-50"
        >
          simétrica
        </button>
      </div>
    </div>
  )
}

export function VisitWindowText({
  visit,
}: {
  visit: { windowDays?: number | null; windowBefore?: number | null; windowAfter?: number | null }
}) {
  const label = formatVisitWindow(visit)
  if (label === '—') return <span className="text-alphi-border">—</span>
  return <>{label}</>
}
