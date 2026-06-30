'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

export interface SubjectListItem {
  id: string
  subjectCode: string
  status: string
  createdAt: string
}

interface SubjectsClientProps {
  studyId: string
}

const STATUS_LABELS: Record<string, string> = {
  screening: 'Screening',
  enrolled: 'Incluido',
  screen_failed: 'Screen fail',
  withdrawn: 'Retirado',
  completed: 'Completado',
}

export default function SubjectsClient({ studyId }: SubjectsClientProps) {
  const [subjects, setSubjects] = useState<SubjectListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newCode, setNewCode] = useState('')
  const [creating, setCreating] = useState(false)

  const loadSubjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/studies/${studyId}/subjects`)
      if (res.status === 403) {
        setError('Tu rol no tiene acceso a datos de sujetos (PHI).')
        return
      }
      if (res.status === 503) {
        setError(
          'Falta PHI_ENCRYPTION_KEY en .env.local — ejecutá: node scripts/generate-phi-key.mjs',
        )
        return
      }
      if (!res.ok) throw new Error('fetch_failed')
      const data = (await res.json()) as SubjectListItem[]
      setSubjects(data)
    } catch {
      setError('No se pudo cargar la lista de sujetos.')
    } finally {
      setLoading(false)
    }
  }, [studyId])

  useEffect(() => {
    void loadSubjects()
  }, [loadSubjects])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newCode.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch(`/api/studies/${studyId}/subjects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectCode: newCode.trim() }),
      })
      if (res.status === 409) {
        setError('Ese código de sujeto ya existe en el estudio.')
        return
      }
      if (res.status === 503) {
        setError('Falta PHI_ENCRYPTION_KEY en .env.local')
        return
      }
      if (!res.ok) throw new Error('create_failed')
      setNewCode('')
      await loadSubjects()
    } catch {
      setError('No se pudo crear el sujeto.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-alphi-navy">Sujetos del estudio</h2>
        <p className="mt-1 text-sm text-alphi-muted">
          Pseudonimizados (código de sujeto). Evoluciones clínicas cifradas at-rest.
        </p>
      </div>

      <div className="rounded-lg border border-alphi-amber/20 bg-alphi-amber/5 px-4 py-3">
        <p className="text-xs leading-relaxed text-alphi-navy/80">
          <strong className="text-alphi-amber">PHI — Local dev:</strong>{' '}
          No incluyas nombre, DNI ni teléfono en las evoluciones. Configurá{' '}
          <code className="rounded bg-white/60 px-1">PHI_ENCRYPTION_KEY</code> antes de guardar.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="subjectCode" className="alphi-label mb-1 block">
            Nuevo código de sujeto
          </label>
          <input
            id="subjectCode"
            type="text"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value.toUpperCase())}
            placeholder="GZBO-001"
            className="rounded-lg border border-alphi-border px-3 py-2 font-mono text-sm"
            maxLength={32}
          />
        </div>
        <button type="submit" disabled={creating || !newCode.trim()} className="alphi-btn-primary">
          {creating ? 'Creando…' : 'Agregar sujeto'}
        </button>
      </form>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-alphi-muted">Cargando sujetos…</p>
      ) : subjects.length === 0 ? (
        <p className="text-sm text-alphi-muted">No hay sujetos registrados. Creá el primero arriba.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-alphi-border">
          <table className="w-full text-sm">
            <thead className="bg-alphi-slate/80 text-left text-xs uppercase tracking-wide text-alphi-muted">
              <tr>
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Alta</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-alphi-border bg-white">
              {subjects.map((s) => (
                <tr key={s.id} className="hover:bg-alphi-slate/30">
                  <td className="px-4 py-3 font-mono font-semibold text-alphi-navy">{s.subjectCode}</td>
                  <td className="px-4 py-3">
                    <span className="alphi-pill text-xs">{STATUS_LABELS[s.status] ?? s.status}</span>
                  </td>
                  <td className="px-4 py-3 text-alphi-muted">
                    {new Date(s.createdAt).toLocaleDateString('es-AR')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/studies/${studyId}/subjects/${s.id}`}
                      className="alphi-btn-secondary text-xs"
                    >
                      Evolución
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
