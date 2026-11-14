'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  MODE_CONFIRM_TEXTS,
  MODE_DEADLINE_TEXTS,
  MODE_ERROR_TEXTS,
  MODE_PANEL_LABELS,
} from '../../lib/access/team-ui'

/**
 * Panel de cambio de modo (docs/decisions/study-membership.md, sección
 * «Cambio de modo»). Todo sale de /api/org/team/mode: estado, plazo, impacto
 * del paso a estricto y el cambio confirmado. Un cuadro y un botón por flujo
 * (L5); las dos frases de cada confirmación (L21) y todos los textos vienen
 * de lib/access/team-ui.ts (L6).
 */

interface ImpactPerson {
  userId: string
  name: string | null
  losesStudies: Array<{ studyId: string; studyName: string }>
  losesAllStudies: boolean
  stopsAuthoring: boolean
}

interface ModePayload {
  mode: 'open' | 'enforced'
  columnMode: 'open' | 'enforced'
  openUntil: string | null
  daysLeft: number | null
  /** M20: abierto con el plazo vencido. */
  deadlinePassed?: boolean
  impact: ImpactPerson[] | null
}

const GENERIC_ERROR = 'No se pudo guardar; probá de nuevo.'

export function ModePanel({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<ModePayload | null>(null)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [confirming, setConfirming] = useState<'toEnforced' | 'toOpen' | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const res = await fetch('/api/org/team/mode')
    if (!res.ok) throw new Error('load failed')
    setData((await res.json()) as ModePayload)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await load()
      } catch {
        setFailed(true)
      }
    })()
  }, [load])

  async function confirm(target: 'open' | 'enforced'): Promise<void> {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/org/team/mode', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: target }),
      })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        setNotice(error && error in MODE_ERROR_TEXTS ? MODE_ERROR_TEXTS[error as keyof typeof MODE_ERROR_TEXTS] : GENERIC_ERROR)
        setNoticeIsError(true)
        return
      }
      setNotice(MODE_PANEL_LABELS.okChanged)
      setNoticeIsError(false)
      setConfirming(null)
      await load()
      onChanged() // el banner de modo de la pantalla también cambia
    } catch {
      setNotice(GENERIC_ERROR)
      setNoticeIsError(true)
    } finally {
      setBusy(false)
    }
  }

  if (failed) {
    return (
      <section className="alphi-card p-4">
        <p className="text-sm font-semibold text-alphi-navy">{MODE_PANEL_LABELS.title}</p>
        <p className="mt-1 text-sm text-alphi-muted">No se pudo cargar el modo. Recargá la página.</p>
      </section>
    )
  }

  if (!data) {
    return (
      <section className="alphi-card p-4">
        <p className="text-sm font-semibold text-alphi-navy">{MODE_PANEL_LABELS.title}</p>
        <p className="mt-1 text-sm text-alphi-muted">Cargando…</p>
      </section>
    )
  }

  // Mismas reglas que el servidor (canSwitchMode): volver al modo abierto,
  // solo antes del plazo.
  const expiredOpen = data.mode === 'enforced' && data.openUntil !== null && (data.daysLeft ?? 0) <= 0
  const canReturnToOpen = data.mode === 'enforced' && !expiredOpen

  return (
    <section className="alphi-card space-y-3 p-4">
      <p className="text-sm font-semibold text-alphi-navy">{MODE_PANEL_LABELS.title}</p>

      {data.mode === 'open' && data.deadlinePassed ? (
        <p role="alert" className="text-xs font-semibold text-alphi-rose">
          {MODE_DEADLINE_TEXTS.overdue}
        </p>
      ) : data.mode === 'open' && data.daysLeft !== null ? (
        <p className="text-xs text-alphi-muted">{MODE_DEADLINE_TEXTS.daysLeft(data.daysLeft)}</p>
      ) : null}
      {expiredOpen ? <p className="text-xs text-alphi-rose">{MODE_DEADLINE_TEXTS.expired}</p> : null}
      {notice ? (
        <p role="status" className={noticeIsError ? 'text-xs text-alphi-rose' : 'text-xs text-alphi-teal'}>
          {notice}
        </p>
      ) : null}

      {confirming === null ? (
        <div className="flex flex-wrap gap-2">
          {data.mode === 'open' ? (
            <button
              type="button"
              className="alphi-btn-primary px-3 py-1 text-xs"
              onClick={() => setConfirming('toEnforced')}
            >
              {MODE_PANEL_LABELS.toEnforcedButton}
            </button>
          ) : null}
          {canReturnToOpen ? (
            <button
              type="button"
              className="alphi-btn-secondary px-3 py-1 text-xs"
              disabled={busy}
              onClick={() => setConfirming('toOpen')}
            >
              {MODE_PANEL_LABELS.toOpenButton}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-alphi-border bg-alphi-slate p-3">
          <p className="text-xs text-alphi-teal">
            {confirming === 'toEnforced' ? MODE_CONFIRM_TEXTS.toEnforced.gains : MODE_CONFIRM_TEXTS.toOpen.gains}
          </p>
          <p className="text-xs text-alphi-amber">
            {confirming === 'toEnforced' ? MODE_CONFIRM_TEXTS.toEnforced.risk : MODE_CONFIRM_TEXTS.toOpen.risk}
          </p>

          {confirming === 'toEnforced' ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-alphi-navy">{MODE_PANEL_LABELS.impactTitle}</p>
              <ul className="space-y-1">
                {(data.impact ?? []).map((person) => (
                  <li key={person.userId} className="text-xs text-alphi-navy">
                    <span className="font-medium">{person.name ?? person.userId}</span>
                    {person.losesStudies.length > 0 ? (
                      <span className="text-alphi-muted">
                        {' '}
                        {MODE_PANEL_LABELS.losesStudies}: {person.losesStudies.map((s) => s.studyName).join(', ')}.
                      </span>
                    ) : null}
                    {person.losesAllStudies ? (
                      <span className="text-alphi-rose"> {MODE_PANEL_LABELS.losesAllStudies}.</span>
                    ) : null}
                    {person.stopsAuthoring ? (
                      <span className="text-alphi-amber"> {MODE_PANEL_LABELS.stopsAuthoring}.</span>
                    ) : null}
                  </li>
                ))}
                {(data.impact ?? []).length === 0 ? (
                  <li className="text-xs text-alphi-muted">{MODE_PANEL_LABELS.impactEmpty}</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className="alphi-btn-primary px-3 py-1 text-xs"
              disabled={busy}
              onClick={() => void confirm(confirming === 'toEnforced' ? 'enforced' : 'open')}
            >
              {confirming === 'toEnforced' ? MODE_PANEL_LABELS.confirmToEnforced : MODE_PANEL_LABELS.confirmToOpen}
            </button>
            <button
              type="button"
              className="alphi-btn-ghost px-3 py-1 text-xs"
              disabled={busy}
              onClick={() => setConfirming(null)}
            >
              {MODE_PANEL_LABELS.cancel}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
