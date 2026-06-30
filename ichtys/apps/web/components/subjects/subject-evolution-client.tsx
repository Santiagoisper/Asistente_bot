'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

interface EvolutionItem {
  id: string
  visitLabel: string | null
  content: string
  createdAt: string
}

interface PatientProfileView {
  demographics?: { ageYears?: number }
  vitals?: { bloodPressureLabel?: string; systolic?: number; diastolic?: number }
  labs: Array<{ name: string; value: number; unit?: string }>
  medications: Array<{ name: string; dose?: string; frequency?: string }>
  conditions: string[]
  lastUpdatedAt?: string
}

interface ScreeningAssessment {
  criterionNumber: string
  criterionText: string
  kind: 'inclusion' | 'exclusion'
  status: 'pass' | 'fail' | 'unknown'
  reason: string
}

interface SubjectEvolutionClientProps {
  studyId: string
  subjectId: string
}

const STATUS_STYLES: Record<ScreeningAssessment['status'], string> = {
  pass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  fail: 'bg-red-50 text-red-800 border-red-200',
  unknown: 'bg-alphi-slate/40 text-alphi-muted border-alphi-border',
}

export default function SubjectEvolutionClient({ studyId, subjectId }: SubjectEvolutionClientProps) {
  const [subjectCode, setSubjectCode] = useState<string>('…')
  const [evolutions, setEvolutions] = useState<EvolutionItem[]>([])
  const [profile, setProfile] = useState<PatientProfileView | null>(null)
  const [assessments, setAssessments] = useState<ScreeningAssessment[]>([])
  const [specAvailable, setSpecAvailable] = useState(false)
  const [content, setContent] = useState('')
  const [visitLabel, setVisitLabel] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [piiWarnings, setPiiWarnings] = useState<string[]>([])

  const loadScreening = useCallback(async () => {
    try {
      const res = await fetch(`/api/studies/${studyId}/subjects/${subjectId}/screening`)
      if (!res.ok) return
      const data = (await res.json()) as {
        profile: PatientProfileView
        assessments: ScreeningAssessment[]
        specAvailable: boolean
      }
      setProfile(data.profile)
      setAssessments(data.assessments)
      setSpecAvailable(data.specAvailable)
    } catch {
      // screening es complementario — no bloquea la página
    }
  }, [studyId, subjectId])

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
      await loadScreening()
    } catch {
      setError('No se pudieron cargar las evoluciones.')
    } finally {
      setLoading(false)
    }
  }, [studyId, subjectId, loadScreening])

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

  const hasProfileData =
    profile &&
    (profile.demographics?.ageYears ||
      profile.vitals?.bloodPressureLabel ||
      profile.labs.length > 0 ||
      profile.medications.length > 0 ||
      profile.conditions.length > 0)

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
          <p className="text-sm text-alphi-muted">Evolución clínica — Fase 2 (extracción + screening)</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4 rounded-lg border border-alphi-border bg-alphi-slate/20 p-4">
        <div>
          <label htmlFor="visitLabel" className="alphi-label mb-1 block">
            Etiqueta de visita (opcional)
          </label>
          <input
            id="visitLabel"
            type="text"
            value={visitLabel}
            onChange={(e) => setVisitLabel(e.target.value)}
            placeholder="Screening, Visita 2, Baseline…"
            className="w-full max-w-xs rounded-lg border border-alphi-border px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-alphi-muted">
            Aparece como pastilla junto a la fecha en el historial. No va dentro del texto clínico.
          </p>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-alphi-border bg-white p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-alphi-muted">
            Perfil extraído
          </h3>
          {!hasProfileData ? (
            <p className="text-sm text-alphi-muted">
              Guardá una evolución con datos estructurados (edad, HbA1c, PA, medicación) para ver el perfil.
            </p>
          ) : (
            <dl className="space-y-2 text-sm text-alphi-navy">
              {profile?.demographics?.ageYears && (
                <div>
                  <dt className="text-xs text-alphi-muted">Edad</dt>
                  <dd>{profile.demographics.ageYears} años</dd>
                </div>
              )}
              {profile?.vitals?.bloodPressureLabel && (
                <div>
                  <dt className="text-xs text-alphi-muted">Presión arterial</dt>
                  <dd>{profile.vitals.bloodPressureLabel} mmHg</dd>
                </div>
              )}
              {profile && profile.labs.length > 0 && (
                <div>
                  <dt className="text-xs text-alphi-muted">Laboratorio</dt>
                  <dd className="space-y-1">
                    {profile.labs.map((lab) => (
                      <div key={lab.name}>
                        {lab.name}: {lab.value}
                        {lab.unit ? ` ${lab.unit}` : ''}
                      </div>
                    ))}
                  </dd>
                </div>
              )}
              {profile && profile.medications.length > 0 && (
                <div>
                  <dt className="text-xs text-alphi-muted">Medicación</dt>
                  <dd className="space-y-1">
                    {profile.medications.map((m) => (
                      <div key={m.name}>
                        {m.name}
                        {m.dose ? ` ${m.dose}` : ''}
                        {m.frequency ? ` — ${m.frequency}` : ''}
                      </div>
                    ))}
                  </dd>
                </div>
              )}
              {profile && profile.conditions.length > 0 && (
                <div>
                  <dt className="text-xs text-alphi-muted">Condiciones / notas</dt>
                  <dd>{profile.conditions.join(', ')}</dd>
                </div>
              )}
            </dl>
          )}
        </section>

        <section className="rounded-lg border border-alphi-border bg-white p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-alphi-muted">
            Screening (orientativo)
          </h3>
          {!specAvailable ? (
            <p className="text-sm text-alphi-muted">
              Extraé y aprobá el study spec del protocolo para evaluar criterios automáticamente.
            </p>
          ) : assessments.length === 0 ? (
            <p className="text-sm text-alphi-muted">Sin criterios en el spec del estudio.</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {assessments.map((a) => (
                <li
                  key={`${a.kind}-${a.criterionNumber}`}
                  className={`rounded border px-3 py-2 text-xs ${STATUS_STYLES[a.status]}`}
                >
                  <p className="font-semibold">
                    {a.kind === 'inclusion' ? 'Inclusión' : 'Exclusión'} #{a.criterionNumber} — {a.status}
                  </p>
                  <p className="mt-1 opacity-80">{a.reason}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[10px] leading-relaxed text-alphi-muted">
            Apoyo a la decisión — el investigador valida inclusión/exclusión final. Reglas automáticas solo
            cuando hay datos en el perfil (p. ej. HbA1c numérico).
          </p>
        </section>
      </div>

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
