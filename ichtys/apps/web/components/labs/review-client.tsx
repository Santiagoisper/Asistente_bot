'use client'

import Link from 'next/link'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { LabReportContent } from '../../lib/labs/lab-report-content'
import {
  emptyManualRow,
  formatReading,
  readingChoices,
  rowProblem,
  toConfirmPayload,
  toReviewRow,
  withPrintedValue,
  type ReviewRow,
} from '../../lib/labs/review-rows'

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent'
const inputClass = `min-h-11 w-full min-w-0 rounded-lg border border-alphi-border bg-white px-2.5 text-sm text-os-ink ${focusRing}`
const pillBase = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold'

type Phase = 'editing' | 'saving' | 'confirmed' | 'rejected' | 'conflict'

interface Props {
  studyId: string
  subjectId: string
  reportId: string
  subjectCode: string
  studyLabel: string
  status: 'pending_review' | 'confirmed' | 'rejected'
  content: LabReportContent
}

function StatusPill({ row }: { row: ReviewRow }) {
  if (rowProblem(row) === 'reading_unset') return <span className={`${pillBase} bg-[#FFF1D6] text-[#6B4200]`}>Revisar</span>
  if (row.sourceLine === null) return <span className={`${pillBase} bg-[#E2F0F4] text-[#0A4455]`}>Cargado a mano</span>
  if (row.isNewField) return <span className={`${pillBase} bg-[#ECE6F7] text-[#4A2F87]`}>Campo nuevo</span>
  return <span className={`${pillBase} bg-os-tint text-os-accentdim`}>Leído</span>
}

/**
 * Revisión de un informe de laboratorio: el texto del informe a la izquierda,
 * los campos a la derecha. Nada pasa al registro hasta que la persona confirma.
 */
export function LabReviewClient({ studyId, subjectId, reportId, subjectCode, studyLabel, status, content }: Props) {
  const lines = useMemo(() => content.transcription.split('\n'), [content.transcription])
  const unparsed = useMemo(() => new Set(content.unparsedLines), [content.unparsedLines])
  const [rows, setRows] = useState<ReviewRow[]>(() => content.rows.map(toReviewRow))
  const [focusedLine, setFocusedLine] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>(status === 'pending_review' ? 'editing' : status)
  const [error, setError] = useState<string | null>(null)
  const [confirmingReject, setConfirmingReject] = useState(false)
  const [profileWarning, setProfileWarning] = useState(false)

  const editable = phase === 'editing'
  const payload = toConfirmPayload(rows)
  const pendingDecisions = rows.filter((row) => rowProblem(row) === 'reading_unset').length
  const incomplete = rows.filter((row) => {
    const problem = rowProblem(row)
    return problem === 'missing_analyte' || problem === 'missing_value'
  }).length
  const base = `/api/studies/${studyId}/subjects/${subjectId}/lab-reports/${reportId}`

  function update(key: string, change: (row: ReviewRow) => ReviewRow) {
    setRows((current) => current.map((row) => (row.key === key ? change(row) : row)))
  }

  async function send(action: 'confirm' | 'reject') {
    if (action === 'confirm' && !payload) return
    setPhase('saving')
    setError(null)
    try {
      const response = await fetch(`${base}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: action === 'confirm' ? JSON.stringify({ rows: payload }) : undefined,
      })
      if (response.status === 409) {
        setPhase('conflict')
        return
      }
      if (!response.ok) {
        setPhase('editing')
        setError(
          response.status === 400
            ? 'Hay una fila que no coincide con el informe. Revisá los valores corregidos y probá de nuevo.'
            : 'No se pudo guardar. Probá de nuevo.',
        )
        return
      }
      if (action === 'confirm') {
        const result: unknown = await response.json().catch(() => null)
        setProfileWarning(typeof result === 'object' && result !== null && (result as { profileUpdated?: unknown }).profileUpdated === false)
        setPhase('confirmed')
      } else {
        setPhase('rejected')
      }
    } catch {
      setPhase('editing')
      setError('No se pudo guardar. Revisá la conexión y probá de nuevo.')
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-os-subtle">
            <Link href="/laboratorios" className="underline">
              Laboratorios
            </Link>{' '}
            › Revisar estudio
          </p>
          <h1 className="mt-1 text-2xl font-bold text-os-ink">Revisar y confirmar</h1>
          <p className="mt-1 text-sm text-os-subtle">
            {subjectCode} · {studyLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className={`${pillBase} bg-os-tint text-os-accentdim`}>{rows.length} {rows.length === 1 ? 'campo' : 'campos'}</span>
          {pendingDecisions > 0 ? <span className={`${pillBase} bg-[#FFF1D6] text-[#6B4200]`}>{pendingDecisions} para revisar</span> : null}
          {rows.some((row) => row.isNewField) ? (
            <span className={`${pillBase} bg-[#ECE6F7] text-[#4A2F87]`}>{rows.filter((row) => row.isNewField).length} campos nuevos</span>
          ) : null}
        </div>
      </div>

      {phase === 'confirmed' ? (
        <div role="status" className="rounded-2xl bg-os-tint px-5 py-4 text-sm text-os-accentdim">
          <p className="font-semibold">Estudio confirmado. Los valores ya forman parte del registro del sujeto.</p>
          {profileWarning ? (
            <p className="mt-1 text-[#6B4200]">El estudio quedó confirmado, pero no se pudo actualizar el perfil de screening del sujeto. Avisá a soporte.</p>
          ) : null}
          <p className="mt-2 flex flex-wrap gap-4 font-semibold">
            <Link href="/laboratorios" className="underline">Volver a Laboratorios</Link>
            <Link href={`/studies/${studyId}/subjects/${subjectId}`} className="underline">Ver la ficha del sujeto</Link>
            <Link href="/laboratorios/cargar" className="underline">Cargar otro estudio</Link>
          </p>
        </div>
      ) : null}
      {phase === 'rejected' ? (
        <p role="status" className="rounded-2xl bg-[#EEF2F6] px-5 py-4 text-sm font-semibold text-[#334155]">
          Estudio rechazado. No se guardó ningún valor en el registro del sujeto.{' '}
          <Link href="/laboratorios" className="underline">Volver a Laboratorios</Link>
        </p>
      ) : null}
      {phase === 'conflict' ? (
        <p role="alert" className="rounded-2xl bg-[#FFF1D6] px-5 py-4 text-sm font-semibold text-[#6B4200]">
          Este estudio ya fue revisado por otra persona. Recargá la página para ver cómo quedó.
        </p>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="rounded-2xl border border-alphi-border bg-white p-4 shadow-alphi-card" aria-labelledby="informe-original">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="informe-original" className="text-base font-semibold text-os-ink">Texto del informe</h2>
            <span className="text-xs text-os-subtle">Tal cual figura; el encabezado con datos personales se omitió</span>
          </div>
          <ol className="max-h-[70vh] overflow-auto rounded-xl bg-os-ground p-3 font-mono text-[13px] leading-6 text-[#1E293B]">
            {lines.map((line, index) => (
              <li
                key={index}
                className={`whitespace-pre-wrap rounded px-2 ${
                  focusedLine === index
                    ? 'bg-[#FFF1D6] outline outline-2 outline-[#B7791F]'
                    : unparsed.has(index)
                      ? 'border-l-4 border-[#B7791F] bg-white'
                      : ''
                }`}
              >
                {line.length > 0 ? line : ' '}
              </li>
            ))}
          </ol>
          {content.unparsedLines.length > 0 ? (
            <p className="mt-2 text-sm text-[#6B4200]">
              {content.unparsedLines.length} {content.unparsedLines.length === 1 ? 'renglón con números no se interpretó' : 'renglones con números no se interpretaron'} (borde
              ámbar). Si alguno es un resultado, agregalo con “Agregar campo”.
            </p>
          ) : null}
        </section>

        <section className="min-w-0 rounded-2xl border border-alphi-border bg-white p-4 shadow-alphi-card" aria-labelledby="campos-leidos">
          <h2 id="campos-leidos" className="mb-3 text-base font-semibold text-os-ink">Campos</h2>
          <ul className="flex flex-col gap-3">
            {rows.map((row) => {
              const choices = readingChoices(row.printedValue)
              const problem = rowProblem(row)
              return (
                <li
                  key={row.key}
                  className={`rounded-xl border p-3 ${problem === 'reading_unset' ? 'border-[#B7791F] bg-[#FFF9EC]' : 'border-alphi-border'}`}
                  onFocusCapture={() => setFocusedLine(row.sourceLine)}
                  onMouseEnter={() => setFocusedLine(row.sourceLine)}
                >
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
                    <label className="flex flex-col gap-1 text-xs font-semibold text-os-subtle">
                      Analito
                      <input className={inputClass} value={row.analyte} disabled={!editable} maxLength={120} onChange={(event) => update(row.key, (current) => ({ ...current, analyte: event.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-os-subtle">
                      Valor impreso
                      <input className={inputClass} value={row.printedValue} disabled={!editable} maxLength={60} onChange={(event) => update(row.key, (current) => withPrintedValue(current, event.target.value, lines))} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-os-subtle">
                      Unidad
                      <input className={inputClass} value={row.unit} disabled={!editable} maxLength={20} onChange={(event) => update(row.key, (current) => ({ ...current, unit: event.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold text-os-subtle">
                      Rango de referencia
                      <input className={inputClass} value={row.referenceRange} disabled={!editable} maxLength={120} onChange={(event) => update(row.key, (current) => ({ ...current, referenceRange: event.target.value }))} />
                    </label>
                  </div>

                  {choices.length > 0 ? (
                    <fieldset className="mt-3">
                      <legend className="text-sm font-semibold text-[#6B4200]">“{row.printedValue.trim()}” se puede leer de dos formas. ¿Cuál es?</legend>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {choices.map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            disabled={!editable}
                            aria-pressed={row.reading === choice}
                            className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold ${focusRing} ${
                              row.reading === choice ? 'bg-os-accent text-white' : 'border-[1.5px] border-os-accent bg-white text-os-accentdim'
                            }`}
                            onClick={() => update(row.key, (current) => ({ ...current, reading: choice }))}
                          >
                            {formatReading(choice)}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill row={row} />
                      {row.isNewField && row.sourceLine !== null ? <span className="text-xs text-os-subtle">No existía en el programa; se crea al confirmar.</span> : null}
                      {problem === 'missing_analyte' || problem === 'missing_value' ? <span className="text-xs text-[#8C1D3A]">Completá el analito y el valor.</span> : null}
                    </div>
                    {editable ? (
                      <button
                        type="button"
                        className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-[#8C1D3A] hover:bg-[#FBE3E7] ${focusRing}`}
                        onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                        Quitar
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>

          {editable ? (
            <button
              type="button"
              className={`mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border-[1.5px] border-dashed border-os-accent px-4 text-sm font-semibold text-os-accentdim hover:bg-os-tint ${focusRing}`}
              onClick={() => setRows((current) => [...current, emptyManualRow()])}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Agregar campo
            </button>
          ) : null}

          {error ? (
            <p role="alert" className="mt-3 rounded-xl bg-[#FBE3E7] px-4 py-3 text-sm text-[#8C1D3A]">
              {error}
            </p>
          ) : null}

          {editable || phase === 'saving' ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-alphi-border pt-4">
              {confirmingReject ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-[#8C1D3A]">¿Rechazar el estudio? No se guarda ningún valor.</span>
                  <button type="button" disabled={phase === 'saving'} className={`inline-flex min-h-11 items-center rounded-lg bg-[#A6314F] px-4 text-sm font-semibold text-white disabled:opacity-50 ${focusRing}`} onClick={() => void send('reject')}>
                    Sí, rechazar
                  </button>
                  <button type="button" className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-os-ink ${focusRing}`} onClick={() => setConfirmingReject(false)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <button type="button" disabled={phase === 'saving'} className={`inline-flex min-h-11 items-center rounded-lg border-[1.5px] border-[#A6314F] bg-white px-4 text-sm font-semibold text-[#8C1D3A] disabled:opacity-50 ${focusRing}`} onClick={() => setConfirmingReject(true)}>
                  Rechazar estudio
                </button>
              )}
              <div className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  disabled={!payload || phase === 'saving'}
                  aria-describedby="confirmar-ayuda"
                  className={`inline-flex min-h-11 items-center rounded-lg bg-os-accent px-5 text-sm font-semibold text-white hover:bg-os-accentdim disabled:opacity-50 ${focusRing}`}
                  onClick={() => void send('confirm')}
                >
                  {phase === 'saving' ? 'Guardando…' : `Confirmar ${rows.length} ${rows.length === 1 ? 'valor' : 'valores'}`}
                </button>
                <p id="confirmar-ayuda" className="text-xs text-os-subtle">
                  {pendingDecisions > 0
                    ? `Falta decidir ${pendingDecisions === 1 ? 'una lectura' : `${pendingDecisions} lecturas`}.`
                    : incomplete > 0
                      ? 'Hay campos sin completar.'
                      : rows.length === 0
                        ? 'No hay campos para confirmar.'
                        : 'Al confirmar, los valores pasan al registro con tu usuario, fecha y hora.'}
                </p>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
