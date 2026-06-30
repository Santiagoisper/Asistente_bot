'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

interface EvolutionItem {
  id: string
  visitLabel: string | null
  content: string
  createdAt: string
}

interface SubjectEvolutionClientProps {
  studyId: string
  subjectId: string
}

export default function SubjectEvolutionClient({ studyId, subjectId }: SubjectEvolutionClientProps) {
  const [subjectCode, setSubjectCode] = useState<string>('…')
  const [evolutions, setEvolutions] = useState<EvolutionItem[]>([])
  const [content, setContent] = useState('')
  const [visitLabel, setVisitLabel] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [piiWarnings, setPiiWarnings] = useState<string[]>([])

  const loadEvolutions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/studies/${studyId}/subjects/${subjectId}/evolutions`)
      if (res.status === 403) {
        setError('Sin acceso PHI para este sujeto.')
        return
      }
      if (res.status === 503) {
        setError('Configurá PHI_ENCRYPTION_KEY en .env.local')
        return
      }
      if (!res.ok) throw new Error('fetch_failed')
      const data = (await res.json()) as { subjectCode: string; evolutions: EvolutionItem[] }
      setSubjectCode(data.subjectCode)
      setEvolutions(data.evolutions)
    } catch {
      setError('No se pudieron cargar las evoluciones.')
    } finally {
      setLoading(false)
    }
  }, [studyId, subjectId])

  useEffect(() => {
    void loadEvolutions()
  }, [loadEvolutions])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    setSaving(true)
    setError(null)
    setPiiWarnings([])
    try {
      const res = await fetch(`/api/studies/${studyId}/subjects/${subjectId}/evolutions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          visitLabel: visitLabel.trim() || undefined,
        }),
      })
      const data = (await res.json()) as { piiWarnings?: string[]; error?: string }
      if (res.status === 503) {
        setError('Configurá PHI_ENCRYPTION_KEY en .env.local')
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'save_failed')
      if (data.piiWarnings?.length) setPiiWarnings(data.piiWarnings)
      setContent('')
      setVisitLabel('')
      await loadEvolutions()
    } catch {
      setError('No se pudo guardar la evolución.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href={`/studies/${studyId}/subjects`}
            className="text-xs font-semibold text-alphi-teal hover:underline"
          >
            ← Volver a sujetos
          </Link>
          <h2 className="mt-2 font-mono text-xl font-bold text-alphi-navy">{subjectCode}</h2>
          <p className="text-sm text-alphi-muted">Evolución clínica — Fase 1 local</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4 rounded-lg border border-alphi-border bg-alphi-slate/20 p-4">
        <div>
          <label htmlFor="visitLabel" className="alphi-label mb-1 block">
            Visita (opcional)
          </label>
          <input
            id="visitLabel"
            type="text"
            value={visitLabel}
            onChange={(e) => setVisitLabel(e.target.value)}
            placeholder="Screening, Visita 2…"
            className="w-full max-w-xs rounded-lg border border-alphi-border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="content" className="alphi-label mb-1 block">
            Evolución clínica
          </label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            placeholder="Ej.: Paciente de 52 años. Antecedente DM2. Medicación: metformina 850 mg c/12h. HbA1c 8.2% (lab 15/06)…"
            className="w-full rounded-lg border border-alphi-border px-3 py-2 text-sm leading-relaxed"
          />
        </div>
        <button type="submit" disabled={saving || !content.trim()} className="alphi-btn-primary">
          {saving ? 'Guardando…' : 'Guardar evolución'}
        </button>
      </form>

      {piiWarnings.length > 0 && (
        <div className="rounded-lg border border-alphi-amber/30 bg-alphi-amber/10 px-4 py-3">
          <p className="text-xs font-semibold text-alphi-amber">Alerta de posible PII detectada:</p>
          <ul className="mt-1 list-inside list-disc text-xs text-alphi-navy/80">
            {piiWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</p>
      )}

      <div>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-alphi-muted">Historial</h3>
        {loading ? (
          <p className="text-sm text-alphi-muted">Cargando…</p>
        ) : evolutions.length === 0 ? (
          <p className="text-sm text-alphi-muted">Sin evoluciones guardadas.</p>
        ) : (
          <ul className="space-y-4">
            {evolutions.map((evo) => (
              <li key={evo.id} className="rounded-lg border border-alphi-border bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-alphi-muted">
                  <time dateTime={evo.createdAt}>
                    {new Date(evo.createdAt).toLocaleString('es-AR')}
                  </time>
                  {evo.visitLabel && (
                    <span className="alphi-pill text-[10px]">{evo.visitLabel}</span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-alphi-navy">{evo.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
