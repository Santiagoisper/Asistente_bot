'use client'

import { useCallback, useEffect, useState } from 'react'
import type { MemberFunction } from '@ichtys/db'
import { ModePanel } from './mode-panel'
import { MONITOR_MEMBERSHIP_MAX_DAYS } from '../../lib/access/permissions'
import {
  ACCESS_EXPIRY_GUIDE,
  API_ERROR_TEXTS,
  FUNCTION_HINTS,
  FUNCTION_LABELS,
  MODE_TEXTS,
  ROLE_LABELS,
} from '../../lib/access/team-ui'

/**
 * Pantalla «Equipo y accesos» (docs/decisions/study-membership.md, paso 5).
 * Todo sale de la API (/api/org/team y sus dos subrutas); acá no hay lógica de
 * acceso propia. Cada flujo es un cuadro con su único botón (L5), y los textos
 * que la persona lee vienen de lib/access/team-ui.ts (L6).
 */

const DAY = 24 * 60 * 60 * 1000

export interface TeamPayload {
  mode: 'open' | 'enforced'
  openUntil: string | null
  truncated: boolean
  people: {
    userId: string
    name: string
    identifier: string
    role: string
    functions: MemberFunction[]
    suggestedFunctions: MemberFunction[]
    studies: { studyId: string; studyLabel: string | null; expiresAt: string | null }[]
    authorsWithoutInvestigator: boolean
    isSelf: boolean
  }[]
  studies: { id: string; name: string }[]
  orphanUserIds: string[]
}

type Action =
  | { kind: 'grant-function'; userId: string; functionKey: MemberFunction }
  | { kind: 'revoke-function'; userId: string; functionKey: MemberFunction }
  | { kind: 'grant-membership'; userId: string; studyId: string; studyLabel: string | null; expiresAt: string | null }
  | { kind: 'revoke-membership'; userId: string; studyId: string }

const ACTION_OK: Record<Action['kind'], string> = {
  'grant-function': 'Función asignada.',
  'revoke-function': 'Función quitada.',
  'grant-membership': 'Acceso dado.',
  'revoke-membership': 'Acceso quitado.',
}

function actionRequest(action: Action): { url: string; method: string; body: Record<string, unknown> } {
  switch (action.kind) {
    case 'grant-function':
      return { url: '/api/org/team/functions', method: 'POST', body: { userId: action.userId, functionKey: action.functionKey } }
    case 'revoke-function':
      return { url: '/api/org/team/functions', method: 'DELETE', body: { userId: action.userId, functionKey: action.functionKey } }
    case 'grant-membership':
      return {
        url: '/api/org/team/memberships',
        method: 'POST',
        body: {
          userId: action.userId,
          studyId: action.studyId,
          ...(action.studyLabel ? { studyLabel: action.studyLabel } : {}),
          ...(action.expiresAt ? { expiresAt: action.expiresAt } : {}),
        },
      }
    case 'revoke-membership':
      return { url: '/api/org/team/memberships', method: 'DELETE', body: { userId: action.userId, studyId: action.studyId } }
  }
}

/** Traduce un rechazo de la API al texto de team-ui; nunca muestra internals. */
async function errorText(res: Response): Promise<string> {
  try {
    const { error } = (await res.json()) as { error?: string }
    if (error && error in API_ERROR_TEXTS) return API_ERROR_TEXTS[error as keyof typeof API_ERROR_TEXTS]
  } catch {
    // sin cuerpo JSON: cae al genérico
  }
  return 'No se pudo guardar; probá de nuevo.'
}

const isoDate = (daysFromNow: number): string => new Date(Date.now() + daysFromNow * DAY).toISOString().slice(0, 10)

export function TeamAccessScreen() {
  const [data, setData] = useState<TeamPayload | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [pendingAction, setPendingAction] = useState<Action | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const res = await fetch('/api/org/team')
    if (!res.ok) throw new Error('load failed')
    setData((await res.json()) as TeamPayload)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await load()
      } catch {
        setLoadFailed(true)
      }
    })()
  }, [load])

  async function run(action: Action): Promise<void> {
    setPendingAction(action)
    setNotice(null)
    try {
      const { url, method, body } = actionRequest(action)
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        setNotice(await errorText(res))
        setNoticeIsError(true)
        return
      }
      setNotice(ACTION_OK[action.kind])
      setNoticeIsError(false)
      await load() // el estado que se ve vuelve a ser el del servidor
    } catch {
      setNotice('No se pudo guardar; probá de nuevo.')
      setNoticeIsError(true)
    } finally {
      setPendingAction(null)
    }
  }

  if (loadFailed) {
    return (
      <section className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold text-alphi-navy">Equipo y accesos</h1>
        <p className="rounded-md border border-alphi-rose/30 bg-alphi-rose/10 px-4 py-3 text-sm text-alphi-rose">
          No se pudo cargar el equipo. Recargá la página.
        </p>
      </section>
    )
  }

  if (!data) {
    return (
      <section className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold text-alphi-navy">Equipo y accesos</h1>
        <p className="text-sm text-alphi-muted">Cargando…</p>
      </section>
    )
  }

  const mode = MODE_TEXTS[data.mode]

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-alphi-navy">Equipo y accesos</h1>
        <p className="mt-1 text-sm text-alphi-muted">Quién tiene cada función y a qué estudios entra.</p>
      </div>

      <div className="alphi-card p-4">
        <p className="text-sm font-semibold text-alphi-navy">{mode.title}</p>
        <p className="mt-1 text-sm text-alphi-muted">{mode.detail}</p>
      </div>

      <ModePanel onChanged={load} />

      {data.truncated ? (
        <p className="rounded-md border border-alphi-amber/30 bg-alphi-amber/10 px-4 py-3 text-sm text-alphi-amber">
          La lista viene incompleta porque la organización tiene mucha gente. Para dar funciones o accesos, usá el
          identificador exacto de cada persona.
        </p>
      ) : null}

      {data.orphanUserIds.length > 0 ? (
        <div className="alphi-card p-4">
          <p className="text-sm font-semibold text-alphi-navy">Accesos de personas que ya no están</p>
          <p className="mt-1 text-sm text-alphi-muted">
            Quedan funciones o accesos de {data.orphanUserIds.length}{' '}
            {data.orphanUserIds.length === 1 ? 'persona que dejó' : 'personas que dejaron'} la organización. Figuran
            abajo para poder darlas de baja.
          </p>
        </div>
      ) : null}

      {notice ? (
        <p
          role="status"
          className={
            noticeIsError
              ? 'rounded-md border border-alphi-rose/30 bg-alphi-rose/10 px-4 py-3 text-sm text-alphi-rose'
              : 'rounded-md border border-alphi-teal/30 bg-alphi-teal/10 px-4 py-3 text-sm text-alphi-teal'
          }
        >
          {notice}
        </p>
      ) : null}

      <div className="space-y-4">
        {data.people.map((person) => (
          <MemberRow
            key={person.userId}
            person={person}
            studies={data.studies}
            pending={pendingAction}
            onAction={(action) => void run(action)}
          />
        ))}
        {data.people.length === 0 ? (
          <p className="text-sm text-alphi-muted">No hay integrantes en la organización.</p>
        ) : null}
      </div>
    </section>
  )
}

function MemberRow({
  person,
  studies,
  pending,
  onAction,
}: {
  person: TeamPayload['people'][number]
  studies: TeamPayload['studies']
  pending: Action | null
  onAction: (action: Action) => void
}) {
  // Un cuadro por flujo (L5): funciones acá, accesos a estudios más abajo.
  const [selectedFunction, setSelectedFunction] = useState<MemberFunction | ''>('')
  const [selectedStudy, setSelectedStudy] = useState<string>('')
  const [studyLabel, setStudyLabel] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const studyName = (studyId: string): string => studies.find((s) => s.id === studyId)?.name ?? studyId
  const assignableFunctions = (Object.keys(FUNCTION_LABELS) as MemberFunction[]).filter(
    (fn) => !person.functions.includes(fn),
  )
  const monitorNeedsExpiry = person.functions.includes('monitor')
  const isBusy = pending !== null && 'userId' in pending && pending.userId === person.userId

  function grantMembership(): void {
    setLocalError(null)
    // La validación del servidor (M4/M18/M19), anticipada acá para no hacer
    // viajar un cuerpo que ya sabemos rechazado. El servidor sigue mandando.
    if (monitorNeedsExpiry && !expiresOn) {
      setLocalError(API_ERROR_TEXTS.monitor_requires_expiry)
      return
    }
    if (expiresOn && new Date(`${expiresOn}T00:00:00Z`).getTime() - Date.now() > MONITOR_MEMBERSHIP_MAX_DAYS * DAY) {
      setLocalError(API_ERROR_TEXTS.monitor_expiry_too_far)
      return
    }
    onAction({
      kind: 'grant-membership',
      userId: person.userId,
      studyId: selectedStudy,
      studyLabel: studyLabel.trim() || null,
      expiresAt: expiresOn ? new Date(`${expiresOn}T00:00:00Z`).toISOString() : null,
    })
  }

  return (
    <article className="alphi-card divide-y divide-alphi-border">
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-alphi-navy">
            {person.name}
            {person.isSelf ? <span className="ml-2 text-xs font-normal text-alphi-muted">(vos)</span> : null}
          </p>
          <p className="text-xs text-alphi-muted">
            {person.identifier} · rol: {ROLE_LABELS[person.role as keyof typeof ROLE_LABELS] ?? person.role}
          </p>
        </div>
        {person.authorsWithoutInvestigator ? (
          <p className="text-xs text-alphi-amber">Escribió evoluciones y no tiene la función Investigador/a (M15)</p>
        ) : null}
      </header>

      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {person.functions.map((fn) => (
            <span
              key={fn}
              title={FUNCTION_HINTS[fn]}
              className="inline-flex items-center gap-1 rounded-full border border-alphi-teal/40 bg-alphi-teal/10 px-2.5 py-0.5 text-xs text-alphi-teal"
            >
              {FUNCTION_LABELS[fn]}
              <button
                type="button"
                aria-label={`Quitar ${FUNCTION_LABELS[fn]}`}
                disabled={isBusy}
                onClick={() => onAction({ kind: 'revoke-function', userId: person.userId, functionKey: fn })}
                className="rounded px-1 text-alphi-muted hover:bg-alphi-teal/20 hover:text-alphi-teal"
              >
                ×
              </button>
            </span>
          ))}
          {person.functions.length === 0 ? <span className="text-xs text-alphi-muted">Sin funciones cargadas.</span> : null}
        </div>

        {person.suggestedFunctions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-alphi-muted">Sugerido por su rol:</span>
            {person.suggestedFunctions.map((fn) => (
              <button
                key={fn}
                type="button"
                title={FUNCTION_HINTS[fn]}
                disabled={isBusy}
                onClick={() => onAction({ kind: 'grant-function', userId: person.userId, functionKey: fn })}
                className="alphi-btn-ghost rounded-full border border-dashed border-alphi-border px-2.5 py-0.5 text-xs"
              >
                + {FUNCTION_LABELS[fn]}
              </button>
            ))}
          </div>
        ) : null}

        {assignableFunctions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Función para ${person.name}`}
              value={selectedFunction}
              onChange={(e) => setSelectedFunction(e.target.value as MemberFunction | '')}
              className="rounded border border-alphi-border bg-white px-2 py-1 text-xs text-alphi-navy"
            >
              <option value="">Elegir función…</option>
              {assignableFunctions.map((fn) => (
                <option key={fn} value={fn} title={FUNCTION_HINTS[fn]}>
                  {FUNCTION_LABELS[fn]}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={isBusy || selectedFunction === ''}
              onClick={() => {
                if (selectedFunction === '') return // estrecha el estado para el cuerpo del pedido
                onAction({ kind: 'grant-function', userId: person.userId, functionKey: selectedFunction })
                setSelectedFunction('')
              }}
              className="alphi-btn-secondary px-3 py-1 text-xs"
            >
              Asignar
            </button>
          </div>
        ) : (
          <p className="text-xs text-alphi-muted">Tiene todas las funciones.</p>
        )}
      </div>

      <div className="space-y-3 px-4 py-3">
        <ul className="space-y-1">
          {person.studies.map((membership) => {
            const expired = membership.expiresAt !== null && new Date(membership.expiresAt).getTime() <= Date.now()
            return (
              <li key={membership.studyId} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-alphi-navy">
                  {studyName(membership.studyId)}
                  {membership.studyLabel ? <span className="text-alphi-muted"> · {membership.studyLabel}</span> : null}
                  {membership.expiresAt ? (
                    <span className={expired ? 'text-alphi-rose' : 'text-alphi-muted'}>
                      {' '}
                      · vence {new Date(membership.expiresAt).toLocaleDateString('es-AR')}
                      {expired ? ' (vencido)' : ''}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => onAction({ kind: 'revoke-membership', userId: person.userId, studyId: membership.studyId })}
                  className="rounded px-2 py-0.5 text-alphi-muted hover:bg-alphi-rose/10 hover:text-alphi-rose"
                >
                  Quitar acceso
                </button>
              </li>
            )
          })}
          {person.studies.length === 0 ? (
            <li className="text-xs text-alphi-muted">Sin acceso a estudios.</li>
          ) : null}
        </ul>

        {studies.length > 0 ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Estudio para ${person.name}`}
                value={selectedStudy}
                onChange={(e) => setSelectedStudy(e.target.value)}
                className="rounded border border-alphi-border bg-white px-2 py-1 text-xs text-alphi-navy"
              >
                <option value="">Elegir estudio…</option>
                {studies.map((study) => (
                  <option key={study.id} value={study.id}>
                    {study.name}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Etiqueta en el estudio para ${person.name}`}
                value={studyLabel}
                onChange={(e) => setStudyLabel(e.target.value)}
                maxLength={60}
                placeholder="Etiqueta (PI, Sub-PI…)"
                className="w-40 rounded border border-alphi-border bg-white px-2 py-1 text-xs text-alphi-navy"
              />
              <input
                type="date"
                aria-label={`Vencimiento para ${person.name}`}
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                min={isoDate(1)}
                max={isoDate(MONITOR_MEMBERSHIP_MAX_DAYS)}
                required={monitorNeedsExpiry || undefined}
                className="rounded border border-alphi-border bg-white px-2 py-1 text-xs text-alphi-navy"
              />
              <button
                type="button"
                disabled={isBusy || selectedStudy === ''}
                onClick={grantMembership}
                className="alphi-btn-primary px-3 py-1 text-xs"
              >
                Dar acceso
              </button>
            </div>
            <p className="text-xs text-alphi-muted">{ACCESS_EXPIRY_GUIDE}</p>
            {localError ? <p className="text-xs text-alphi-rose">{localError}</p> : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}
