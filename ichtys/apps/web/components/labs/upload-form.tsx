'use client'

import { useRouter } from 'next/navigation'
import { Plus, Upload } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { MAX_LAB_PDF_BYTES } from '../../lib/labs/lab-report-content'
import {
  MAX_LAB_PDF_MB,
  createSubjectError,
  missingSteps,
  subjectCodeProblem,
  subjectCountLabel,
  uploadError,
  type SubjectsState,
} from '../../lib/labs/upload-form-state'

interface StudyChoice {
  id: string
  label: string
  subjectCount: number
}

interface Option {
  id: string
  label: string
}

const fieldClass =
  'min-h-11 w-full rounded-lg border border-alphi-border bg-white px-3 text-sm text-os-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent disabled:bg-os-ground'
const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-os-accent bg-white px-4 text-sm font-semibold text-os-accentdim hover:bg-os-tint disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent'

function isSubjectList(value: unknown): value is Array<{ id: string; subjectCode: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { subjectCode?: unknown }).subjectCode === 'string',
    )
  )
}

function errorCodeOf(payload: unknown): unknown {
  return typeof payload === 'object' && payload !== null ? (payload as { error?: unknown }).error : null
}

export function LabUploadForm({ studies }: { studies: StudyChoice[] }) {
  const router = useRouter()
  const formId = useId()
  // Arranca en un estudio que ya tiene sujetos, si hay alguno.
  const [studyId, setStudyId] = useState((studies.find((study) => study.subjectCount > 0) ?? studies[0])?.id ?? '')
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(studies.map((study) => [study.id, study.subjectCount])))
  const [subjects, setSubjects] = useState<Option[]>([])
  const [subjectsState, setSubjectsState] = useState<SubjectsState>('loading')
  const [reload, setReload] = useState(0)
  const [subjectId, setSubjectId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    if (!studyId) return
    const controller = new AbortController()
    setSubjectsState('loading')
    setSubjects([])
    setSubjectId('')
    setAdding(false)
    setNewCode('')
    setCreateError(null)
    fetch(`/api/studies/${studyId}/subjects`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('subjects_failed')
        const payload: unknown = await response.json()
        if (!isSubjectList(payload)) throw new Error('subjects_invalid')
        const options = payload.map((item) => ({ id: item.id, label: item.subjectCode })).sort((a, b) => a.label.localeCompare(b.label))
        setSubjects(options)
        setSubjectId(options[0]?.id ?? '')
        setCounts((current) => ({ ...current, [studyId]: options.length }))
        setSubjectsState('ready')
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setSubjectsState('error')
      })
    return () => controller.abort()
  }, [studyId, reload])

  function pickFile(next: File | null) {
    setError(null)
    if (next && next.type !== 'application/pdf' && !next.name.toLowerCase().endsWith('.pdf')) {
      setFile(null)
      setError(uploadError(415, 'not_pdf'))
      return
    }
    if (next && next.size > MAX_LAB_PDF_BYTES) {
      setFile(null)
      setError(uploadError(413, null))
      return
    }
    setFile(next)
  }

  async function createSubject() {
    if (creating || !studyId) return
    const problem = subjectCodeProblem(newCode)
    if (problem) {
      setCreateError(problem)
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const response = await fetch(`/api/studies/${studyId}/subjects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectCode: newCode.trim() }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (response.status === 201 && isSubjectList([payload])) {
        const created = (payload as { id: string; subjectCode: string })
        const next = [...subjects, { id: created.id, label: created.subjectCode }].sort((a, b) => a.label.localeCompare(b.label))
        setSubjects(next)
        setSubjectId(created.id)
        setCounts((current) => ({ ...current, [studyId]: next.length }))
        setAdding(false)
        setNewCode('')
        return
      }
      setCreateError(createSubjectError(response.status, errorCodeOf(payload)))
    } catch {
      setCreateError('No se pudo crear el sujeto. Revisá la conexión y probá de nuevo.')
    } finally {
      setCreating(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file || !studyId || !subjectId || busy) return
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.set('file', file)
      const response = await fetch(`/api/studies/${studyId}/subjects/${subjectId}/lab-reports`, { method: 'POST', body })
      const payload: unknown = await response.json().catch(() => null)
      if (response.status === 201 && typeof payload === 'object' && payload !== null && typeof (payload as { reportId?: unknown }).reportId === 'string') {
        router.push(`/studies/${studyId}/subjects/${subjectId}/labs/${(payload as { reportId: string }).reportId}`)
        return
      }
      setError(uploadError(response.status, errorCodeOf(payload)))
    } catch {
      setError('No se pudo subir el archivo. Revisá la conexión y probá de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  const noSubjects = subjectsState === 'ready' && subjects.length === 0
  const showCreate = noSubjects || adding
  const missing = missingSteps({ studyId, subjectsState, subjectCount: subjects.length, subjectId, hasFile: file !== null })
  const ready = missing.length === 0 && !busy

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-os-ink" htmlFor={`${formId}-study`}>
          Estudio
          <select id={`${formId}-study`} className={fieldClass} value={studyId} onChange={(event) => setStudyId(event.target.value)}>
            {studies.map((study) => (
              <option key={study.id} value={study.id}>
                {study.label} — {subjectCountLabel(counts[study.id] ?? study.subjectCount)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-os-ink" htmlFor={`${formId}-subject`}>
            Sujeto
          </label>
          <div className="flex gap-2">
            <select
              id={`${formId}-subject`}
              className={fieldClass}
              value={subjectId}
              disabled={subjectsState !== 'ready' || subjects.length === 0}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              {subjectsState === 'loading' ? <option>Cargando sujetos…</option> : null}
              {subjectsState === 'error' ? <option>No se pudieron cargar los sujetos</option> : null}
              {noSubjects ? <option>Este estudio no tiene sujetos</option> : null}
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.label}
                </option>
              ))}
            </select>
            {subjectsState === 'ready' && subjects.length > 0 && !adding ? (
              <button type="button" className={`${secondaryButtonClass} shrink-0`} onClick={() => setAdding(true)}>
                <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                Nuevo
              </button>
            ) : null}
            {subjectsState === 'error' ? (
              <button type="button" className={`${secondaryButtonClass} shrink-0`} onClick={() => setReload((value) => value + 1)}>
                Reintentar
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {showCreate ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-[#9CC9C1] bg-os-tint px-4 py-4">
          <div>
            <p className="text-sm font-semibold text-os-ink">{noSubjects ? 'Este estudio todavía no tiene sujetos' : 'Nuevo sujeto'}</p>
            <p className="text-sm text-os-subtle">
              {noSubjects ? 'Creá el sujeto acá y seguí con la carga. ' : ''}Usá el código del estudio (por ejemplo 001-014), nunca el nombre ni el documento.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-sm font-semibold text-os-ink" htmlFor={`${formId}-code`}>
              Código del sujeto
              <input
                id={`${formId}-code`}
                className={fieldClass}
                value={newCode}
                maxLength={32}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={createError !== null}
                aria-describedby={createError ? `${formId}-code-error` : undefined}
                onChange={(event) => {
                  setNewCode(event.target.value)
                  setCreateError(null)
                }}
                onKeyDown={(event) => {
                  // Enter crea el sujeto; no envía el formulario de carga.
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void createSubject()
                  }
                }}
              />
            </label>
            <button type="button" className={secondaryButtonClass} disabled={creating} onClick={() => void createSubject()}>
              {creating ? 'Creando…' : 'Crear sujeto'}
            </button>
            {adding && !noSubjects ? (
              <button
                type="button"
                className="min-h-11 rounded-lg px-3 text-sm font-semibold text-os-subtle hover:text-os-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
                onClick={() => {
                  setAdding(false)
                  setNewCode('')
                  setCreateError(null)
                }}
              >
                Cancelar
              </button>
            ) : null}
          </div>
          {createError ? (
            <p id={`${formId}-code-error`} role="alert" className="text-sm text-[#8C1D3A]">
              {createError}
            </p>
          ) : null}
        </div>
      ) : null}

      <label
        htmlFor={`${formId}-file`}
        className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#9CC9C1] bg-[#F2FAF8] px-4 py-8 text-center focus-within:outline focus-within:outline-2 focus-within:outline-os-accent"
      >
        <Upload aria-hidden="true" className="h-8 w-8 text-os-accent" strokeWidth={1.75} />
        <span className="text-sm font-semibold text-os-ink">{file ? file.name : 'Elegí el PDF del laboratorio'}</span>
        <span className="text-sm text-os-subtle">
          PDF digital, hasta {MAX_LAB_PDF_MB} MB y 20 páginas. El archivo se lee y no se guarda.
        </span>
        <input
          id={`${formId}-file`}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
        />
      </label>

      {error ? (
        <p role="alert" className="rounded-xl bg-[#FBE3E7] px-4 py-3 text-sm text-[#8C1D3A]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-sm text-os-subtle">
          El encabezado con nombre y documento se omite antes de guardar. Vas a revisar cada valor antes de confirmar.
        </p>
        <div className="flex flex-col items-end gap-1.5">
          <button
            type="submit"
            disabled={!ready}
            aria-describedby={missing.length > 0 ? `${formId}-missing` : undefined}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-os-accent px-5 text-sm font-semibold text-white hover:bg-os-accentdim disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
          >
            {busy ? 'Leyendo el estudio…' : 'Leer el estudio'}
          </button>
          {missing.length > 0 && !busy ? (
            <p id={`${formId}-missing`} className="text-sm text-os-subtle">
              Falta {missing.join(' y ')}.
            </p>
          ) : null}
        </div>
      </div>
    </form>
  )
}
