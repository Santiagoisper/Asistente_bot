'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { agendaItemKind, type AgendaItemKind, type AgendaItemStatus } from '@ichtys/db/enums'
import { KIND_LABELS, STATUS_LABELS, TITLE_SUGGESTIONS } from '../../lib/agenda/agenda-schema'
import { addDays, dayLabel, isDayKey, isTimeOfDay, shortDayLabel } from '../../lib/agenda/agenda-time'
import { agendaError, daySummary, type AgendaCard } from '../../lib/agenda/agenda-view'

interface StudyChoice {
  id: string
  label: string
}

interface Props {
  day: string
  today: string
  week: string[]
  counts: Record<string, number>
  cards: AgendaCard[]
  studies: StudyChoice[]
  /** Quien mira puede agendar y cambiar turnos. */
  canEdit: boolean
}

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent'
const fieldClass = `min-h-11 w-full rounded-lg border border-alphi-border bg-white px-3 text-sm text-os-ink disabled:bg-os-ground ${focusRing}`
const ghostButton = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-os-accent bg-white px-3 text-sm font-semibold text-os-accentdim hover:bg-os-tint disabled:opacity-50 ${focusRing}`
const STATUS_CLASS: Record<AgendaItemStatus, string> = {
  scheduled: 'bg-[#E2F0F4] text-[#0A4455]',
  done: 'bg-os-tint text-os-accentdim',
  cancelled: 'bg-[#EEF2F6] text-[#334155]',
  no_show: 'bg-[#FBE3E7] text-[#8C1D3A]',
}

function isSubjectList(value: unknown): value is Array<{ id: string; subjectCode: string }> {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string' && typeof (item as { subjectCode?: unknown }).subjectCode === 'string')
}

/** Agenda del sitio: la semana arriba, los turnos del día y el alta de un turno. */
export function AgendaBoard({ day, today, week, counts, cards, studies, canEdit }: Props) {
  const router = useRouter()
  const formId = useId()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState<{ id: string; day: string; time: string } | null>(null)

  const [open, setOpen] = useState(false)
  const [studyId, setStudyId] = useState(studies[0]?.id ?? '')
  const [subjects, setSubjects] = useState<Array<{ id: string; label: string }>>([])
  const [subjectId, setSubjectId] = useState('')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<AgendaItemKind>('visit')
  const [newDay, setNewDay] = useState(day)
  const [time, setTime] = useState('09:00')
  const [duration, setDuration] = useState(30)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => setNewDay(day), [day])

  useEffect(() => {
    if (!open || !studyId) return
    const controller = new AbortController()
    setSubjects([])
    setSubjectId('')
    fetch(`/api/studies/${studyId}/subjects`, { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = response.ok ? await response.json() : []
        if (isSubjectList(payload)) setSubjects(payload.map((item) => ({ id: item.id, label: item.subjectCode })).sort((a, b) => a.label.localeCompare(b.label)))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [open, studyId])

  async function patch(card: AgendaCard, body: Record<string, string>) {
    if (pending) return
    setPending(card.id)
    setError(null)
    try {
      const response = await fetch(`/api/studies/${card.studyId}/agenda/${card.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null)
        setError(agendaError(response.status, typeof payload === 'object' && payload !== null ? (payload as { error?: unknown }).error : null))
        return
      }
      setMoving(null)
      router.refresh()
    } catch {
      setError('No se pudo guardar el cambio. Revisá la conexión y probá de nuevo.')
    } finally {
      setPending(null)
    }
  }

  const formProblem = !studyId ? 'Elegí el estudio.' : title.trim().length < 2 ? 'Escribí el nombre del turno.' : !isDayKey(newDay) ? 'Elegí el día.' : !isTimeOfDay(time) ? 'Elegí la hora.' : null

  async function create(event: FormEvent) {
    event.preventDefault()
    if (saving || formProblem) return
    setSaving(true)
    setFormError(null)
    try {
      const response = await fetch(`/api/studies/${studyId}/agenda`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId: subjectId || null, title: title.trim(), kind, day: newDay, time, durationMinutes: duration, notes: notes.trim() || null }),
      })
      if (response.status !== 201) {
        const payload: unknown = await response.json().catch(() => null)
        setFormError(agendaError(response.status, typeof payload === 'object' && payload !== null ? (payload as { error?: unknown }).error : null))
        return
      }
      setTitle('')
      setNotes('')
      setOpen(false)
      if (newDay === day) router.refresh()
      else router.push(`/agenda?dia=${newDay}`)
    } catch {
      setFormError('No se pudo guardar el turno. Revisá la conexión y probá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Semana" className="flex flex-wrap items-center gap-2">
        <Link href={`/agenda?dia=${addDays(week[0]!, -7)}`} aria-label="Semana anterior" className={ghostButton}>
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </Link>
        <ol className="grid min-w-0 flex-1 grid-cols-7 gap-1.5">
          {week.map((key) => (
            <li key={key}>
              <Link
                href={`/agenda?dia=${key}`}
                aria-current={key === day ? 'date' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center rounded-xl border px-1 text-center text-sm font-semibold ${focusRing} ${
                  key === day ? 'border-os-accent bg-os-accent text-white' : key === today ? 'border-os-accent bg-os-tint text-os-accentdim' : 'border-alphi-border bg-white text-os-ink hover:bg-os-tint'
                }`}
              >
                <span>{shortDayLabel(key)}</span>
                <span className={`text-xs font-normal ${key === day ? 'text-white' : 'text-os-subtle'}`}>{counts[key] ? `${counts[key]} ${counts[key] === 1 ? 'turno' : 'turnos'}` : '—'}</span>
              </Link>
            </li>
          ))}
        </ol>
        <Link href={`/agenda?dia=${addDays(week[0]!, 7)}`} aria-label="Semana siguiente" className={ghostButton}>
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </Link>
        {day !== today ? (
          <Link href="/agenda" className={ghostButton}>
            Hoy
          </Link>
        ) : null}
      </nav>

      <section aria-labelledby={`${formId}-dia`} className="rounded-2xl border border-alphi-border bg-white p-4 shadow-alphi-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id={`${formId}-dia`} className="text-lg font-semibold text-os-ink">
              {dayLabel(day).replace(/^./, (first) => first.toUpperCase())}
              {day === today ? <span className="ml-2 rounded-full bg-os-tint px-2.5 py-1 text-xs font-semibold text-os-accentdim">Hoy</span> : null}
            </h2>
            <p className="text-sm text-os-subtle">{daySummary(cards)}</p>
          </div>
          {canEdit && studies.length > 0 && !open ? (
            <button type="button" className={`inline-flex min-h-11 items-center gap-2 rounded-lg bg-os-accent px-4 text-sm font-semibold text-white hover:bg-os-accentdim ${focusRing}`} onClick={() => setOpen(true)}>
              <CalendarPlus aria-hidden="true" className="h-4 w-4" />
              Agendar turno
            </button>
          ) : null}
        </div>

        {open ? (
          <form onSubmit={create} className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#9CC9C1] bg-os-tint p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-os-ink" htmlFor={`${formId}-study`}>
                Estudio
                <select id={`${formId}-study`} className={fieldClass} value={studyId} onChange={(event) => setStudyId(event.target.value)}>
                  {studies.map((study) => (
                    <option key={study.id} value={study.id}>
                      {study.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-os-ink" htmlFor={`${formId}-subject`}>
                Sujeto
                <select id={`${formId}-subject`} className={fieldClass} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                  <option value="">Sin sujeto (monitoreo, tarea del sitio)</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-os-ink" htmlFor={`${formId}-title`}>
                Turno
                <input id={`${formId}-title`} className={fieldClass} value={title} maxLength={80} list={`${formId}-titles`} autoComplete="off" placeholder="Visita 3" onChange={(event) => setTitle(event.target.value)} />
                <datalist id={`${formId}-titles`}>
                  {TITLE_SUGGESTIONS.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-os-ink" htmlFor={`${formId}-kind`}>
                Tipo
                <select id={`${formId}-kind`} className={fieldClass} value={kind} onChange={(event) => setKind(event.target.value as AgendaItemKind)}>
                  {agendaItemKind.map((option) => (
                    <option key={option} value={option}>
                      {KIND_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-os-ink" htmlFor={`${formId}-day`}>
                Día
                <input id={`${formId}-day`} type="date" className={fieldClass} value={newDay} onChange={(event) => setNewDay(event.target.value)} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-os-ink" htmlFor={`${formId}-time`}>
                  Hora
                  <input id={`${formId}-time`} type="time" className={fieldClass} value={time} onChange={(event) => setTime(event.target.value)} />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-os-ink" htmlFor={`${formId}-duration`}>
                  Duración
                  <select id={`${formId}-duration`} className={fieldClass} value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
                    {[15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-os-ink" htmlFor={`${formId}-notes`}>
              Notas (opcional)
              <textarea id={`${formId}-notes`} className={`${fieldClass} min-h-20 py-2`} value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} />
              <span className="text-xs font-normal text-os-subtle">Se guardan cifradas. En el nombre del turno no pongas datos del paciente.</span>
            </label>
            {formError ? (
              <p role="alert" className="rounded-xl bg-[#FBE3E7] px-4 py-3 text-sm text-[#8C1D3A]">
                {formError}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {formProblem ? <p className="mr-auto text-sm text-os-subtle">{formProblem}</p> : null}
              <button type="button" className={`min-h-11 rounded-lg px-4 text-sm font-semibold text-os-subtle hover:text-os-ink ${focusRing}`} onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button type="submit" disabled={saving || formProblem !== null} className={`inline-flex min-h-11 items-center rounded-lg bg-os-accent px-5 text-sm font-semibold text-white hover:bg-os-accentdim disabled:opacity-50 ${focusRing}`}>
                {saving ? 'Guardando…' : 'Guardar turno'}
              </button>
            </div>
          </form>
        ) : null}

        {error ? (
          <p role="alert" className="mb-3 rounded-xl bg-[#FBE3E7] px-4 py-3 text-sm text-[#8C1D3A]">
            {error}
          </p>
        ) : null}

        {cards.length === 0 ? (
          <p className="rounded-xl bg-os-ground px-4 py-6 text-center text-sm text-os-subtle">
            No hay turnos para este día.{canEdit && studies.length === 0 ? ' Para agendar hace falta un estudio activo.' : ''}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {cards.map((card) => (
              <li key={card.id} className={`rounded-xl border border-alphi-border p-3 ${card.status === 'cancelled' ? 'bg-os-ground opacity-80' : 'bg-white'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <p className="w-14 shrink-0 text-lg font-bold tabular-nums text-os-ink">{card.time}</p>
                    <div className="min-w-0">
                      <p className={`font-semibold text-os-ink ${card.status === 'cancelled' ? 'line-through' : ''}`}>{card.title}</p>
                      <p className="text-sm text-os-subtle">
                        {[card.subjectCode, card.studyLabel, KIND_LABELS[card.kind], card.durationMinutes < 60 ? `${card.durationMinutes} min` : `${card.durationMinutes / 60} h`].filter(Boolean).join(' · ')}
                      </p>
                      {card.notes ? <p className="mt-1 whitespace-pre-wrap text-sm text-os-ink">{card.notes}</p> : null}
                    </div>
                  </div>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[card.status]}`}>{STATUS_LABELS[card.status]}</span>
                </div>

                {canEdit ? (
                  moving?.id === card.id ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-alphi-border pt-3">
                      <label className="flex flex-col gap-1 text-xs font-semibold text-os-subtle">
                        Nuevo día
                        <input type="date" className={fieldClass} value={moving.day} onChange={(event) => setMoving({ ...moving, day: event.target.value })} />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-os-subtle">
                        Nueva hora
                        <input type="time" className={fieldClass} value={moving.time} onChange={(event) => setMoving({ ...moving, time: event.target.value })} />
                      </label>
                      <button type="button" disabled={pending !== null || !isDayKey(moving.day) || !isTimeOfDay(moving.time)} className={ghostButton} onClick={() => void patch(card, { day: moving.day, time: moving.time })}>
                        Guardar
                      </button>
                      <button type="button" className={`min-h-11 rounded-lg px-3 text-sm font-semibold text-os-subtle hover:text-os-ink ${focusRing}`} onClick={() => setMoving(null)}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-alphi-border pt-3">
                      {card.status === 'scheduled' ? (
                        <>
                          <button type="button" disabled={pending !== null} className={ghostButton} onClick={() => void patch(card, { status: 'done' })}>
                            Marcar hecho
                          </button>
                          <button type="button" disabled={pending !== null} className={ghostButton} onClick={() => void patch(card, { status: 'no_show' })}>
                            No vino
                          </button>
                          <button type="button" disabled={pending !== null} className={ghostButton} onClick={() => setMoving({ id: card.id, day: card.day, time: card.time })}>
                            Reprogramar
                          </button>
                          <button type="button" disabled={pending !== null} className={`min-h-11 rounded-lg px-3 text-sm font-semibold text-[#8C1D3A] hover:bg-[#FBE3E7] disabled:opacity-50 ${focusRing}`} onClick={() => void patch(card, { status: 'cancelled' })}>
                            Cancelar turno
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" disabled={pending !== null} className={ghostButton} onClick={() => void patch(card, { status: 'scheduled' })}>
                            Volver a programado
                          </button>
                          {card.status !== 'done' ? (
                            <button type="button" disabled={pending !== null} className={ghostButton} onClick={() => setMoving({ id: card.id, day: card.day, time: card.time })}>
                              Reprogramar
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
