'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDateTime } from '../../lib/os/date-time'
import { describeHistoryEntry, HISTORY_TEXTS, type HistoryEntryView } from '../../lib/access/team-ui'

/**
 * «Qué cambió y quién» dentro de «Equipo y accesos» (docs/decisions/study-membership.md,
 * paso 5). Lee /api/org/team/history; los nombres salen de la lista del equipo
 * que ya cargó la pantalla. `refreshKey` cambia después de cada cambio guardado:
 * el historial vuelve a la primera página.
 */

interface HistoryResponse {
  entries: (HistoryEntryView & { id: number })[]
  next: string | null
}

export function AccessHistoryPanel({
  people,
  studies,
  refreshKey,
  timeZone,
  listTruncated,
}: {
  /** El nombre puede faltar en el proveedor de identidad: entonces va el identificador. */
  people: { userId: string; name: string | null; identifier: string }[]
  studies: { id: string; name: string }[]
  refreshKey: number
  /** Zona del centro (la pasa la página): las horas nunca en la del navegador. */
  timeZone: string
  /** La lista del equipo llegó cortada: quien no figura puede seguir en la organización. */
  listTruncated: boolean
}) {
  const [entries, setEntries] = useState<HistoryResponse['entries']>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const names = useMemo(() => new Map(people.map((p) => [p.userId, p.name || p.identifier])), [people])
  const studyNames = useMemo(() => new Map(studies.map((s) => [s.id, s.name])), [studies])

  const fetchPage = useCallback(async (before: string | null): Promise<HistoryResponse> => {
    const query = before ? `?before=${encodeURIComponent(before)}` : ''
    const res = await fetch(`/api/org/team/history${query}`)
    if (!res.ok) throw new Error('history failed')
    return (await res.json()) as HistoryResponse
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    fetchPage(null)
      .then((page) => {
        if (cancelled) return
        setEntries(page.entries)
        setNext(page.next)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchPage, refreshKey])

  async function loadMore(): Promise<void> {
    if (!next) return
    setLoading(true)
    setFailed(false)
    try {
      const page = await fetchPage(next)
      setEntries((current) => [...current, ...page.entries.filter((e) => !current.some((c) => c.id === e.id))])
      setNext(page.next)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="alphi-card p-4" aria-labelledby="access-history-title">
      <h2 id="access-history-title" className="text-base font-semibold text-alphi-navy">
        {HISTORY_TEXTS.title}
      </h2>
      <p className="mt-1 text-sm text-alphi-muted">{HISTORY_TEXTS.detail}</p>

      {entries.length > 0 ? (
        <ol className="mt-3 divide-y divide-alphi-border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:gap-4">
              <time dateTime={entry.at} className="shrink-0 text-alphi-muted sm:w-40">
                {formatDateTime(entry.at, timeZone)}
              </time>
              <span className="text-alphi-navy">{describeHistoryEntry(entry, names, studyNames, timeZone, { listTruncated })}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {!loading && !failed && entries.length === 0 ? (
        <p className="mt-3 text-sm text-alphi-muted">{HISTORY_TEXTS.empty}</p>
      ) : null}
      {failed ? (
        <p role="status" className="mt-3 text-sm text-alphi-rose">
          {HISTORY_TEXTS.loadFailed}
        </p>
      ) : null}
      {loading ? <p className="mt-3 text-sm text-alphi-muted">{HISTORY_TEXTS.loading}</p> : null}
      {next && !loading ? (
        <button type="button" className="mt-3 text-sm font-semibold text-alphi-teal underline" onClick={() => void loadMore()}>
          {HISTORY_TEXTS.more}
        </button>
      ) : null}
    </div>
  )
}
