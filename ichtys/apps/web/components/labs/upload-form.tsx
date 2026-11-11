'use client'

import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'

interface Option {
  id: string
  label: string
}

const MAX_BYTES = 10 * 1024 * 1024
const fieldClass =
  'min-h-11 w-full rounded-lg border border-alphi-border bg-white px-3 text-sm text-os-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent disabled:bg-os-ground'

/** Mensaje para cada respuesta del servidor. Nunca muestra texto del documento. */
const ERRORS: Record<string, string> = {
  no_text: 'Ese PDF es un escaneo: no tiene texto seleccionable. La carga por foto o escaneo llega en la próxima etapa.',
  no_rows: 'No se encontraron resultados en ese PDF. Revisá que sea un informe de laboratorio.',
  too_many_pages: 'El informe tiene más de 20 páginas. Subí solo las hojas de resultados.',
  unreadable: 'No se pudo leer ese PDF. Probá descargarlo de nuevo del laboratorio.',
  not_pdf: 'El archivo no es un PDF.',
}

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

export function LabUploadForm({ studies }: { studies: Option[] }) {
  const router = useRouter()
  const formId = useId()
  const [studyId, setStudyId] = useState(studies[0]?.id ?? '')
  const [subjects, setSubjects] = useState<Option[]>([])
  const [subjectsState, setSubjectsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [subjectId, setSubjectId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!studyId) return
    const controller = new AbortController()
    setSubjectsState('loading')
    setSubjects([])
    setSubjectId('')
    fetch(`/api/studies/${studyId}/subjects`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('subjects_failed')
        const payload: unknown = await response.json()
        if (!isSubjectList(payload)) throw new Error('subjects_invalid')
        const options = payload.map((item) => ({ id: item.id, label: item.subjectCode })).sort((a, b) => a.label.localeCompare(b.label))
        setSubjects(options)
        setSubjectId(options[0]?.id ?? '')
        setSubjectsState('ready')
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setSubjectsState('error')
      })
    return () => controller.abort()
  }, [studyId])

  function pickFile(next: File | null) {
    setError(null)
    if (next && next.type !== 'application/pdf') {
      setFile(null)
      setError(ERRORS.not_pdf ?? null)
      return
    }
    if (next && next.size > MAX_BYTES) {
      setFile(null)
      setError('El archivo pesa más de 10 MB.')
      return
    }
    setFile(next)
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
      const code = typeof payload === 'object' && payload !== null ? (payload as { error?: unknown }).error : null
      setError(
        (typeof code === 'string' && ERRORS[code]) ||
          (response.status === 413 ? 'El archivo pesa más de 10 MB.' : 'No se pudo leer el estudio. Probá de nuevo.'),
      )
    } catch {
      setError('No se pudo subir el archivo. Revisá la conexión y probá de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  const ready = Boolean(file && studyId && subjectId) && !busy

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
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
          <select
            id={`${formId}-subject`}
            className={fieldClass}
            value={subjectId}
            disabled={subjectsState !== 'ready' || subjects.length === 0}
            onChange={(event) => setSubjectId(event.target.value)}
          >
            {subjectsState === 'loading' ? <option>Cargando sujetos…</option> : null}
            {subjectsState === 'error' ? <option>No se pudieron cargar los sujetos</option> : null}
            {subjectsState === 'ready' && subjects.length === 0 ? <option>Este estudio no tiene sujetos</option> : null}
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label
        htmlFor={`${formId}-file`}
        className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#9CC9C1] bg-[#F2FAF8] px-4 py-8 text-center focus-within:outline focus-within:outline-2 focus-within:outline-os-accent"
      >
        <Upload aria-hidden="true" className="h-8 w-8 text-os-accent" strokeWidth={1.75} />
        <span className="text-sm font-semibold text-os-ink">{file ? file.name : 'Elegí el PDF del laboratorio'}</span>
        <span className="text-sm text-os-subtle">PDF digital, hasta 10 MB y 20 páginas. El archivo se lee y no se guarda.</span>
        <input
          id={`${formId}-file`}
          type="file"
          accept="application/pdf"
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
        <button
          type="submit"
          disabled={!ready}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-os-accent px-5 text-sm font-semibold text-white hover:bg-os-accentdim disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
        >
          {busy ? 'Leyendo el estudio…' : 'Leer el estudio'}
        </button>
      </div>
    </form>
  )
}
