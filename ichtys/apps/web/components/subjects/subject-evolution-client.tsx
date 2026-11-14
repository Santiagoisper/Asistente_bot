'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { matchProtocolVisit, mergeDictationAddition, NOT_MENTIONED, studyDictationPrompts, type ProtocolVisit } from '@ichtys/clinical'
import { bloodPressureProposalLabel } from '../../lib/subjects/proposal-display'
import { unapprovedSpecNotice } from '../../lib/subjects/spec-notice'
import { DictationPanel, type DictationRecording, type DictationSource } from './dictation-panel'
import { DictationGuide } from './dictation-guide'
import { ProfileUnreadableNotice } from './profile-unreadable-notice'
import { profileWriteErrorMessage } from '../../lib/subjects/profile-write-messages'
import { addRecordingTake, groupAudiosByEvolution, uploadNotice, uploadRecordingTakes, type AudioListingItem } from '../../lib/dictation/takes'
import { criterionStatusLabel } from '../../lib/subjects/screening-labels'
import { EvolutionAudios, type EvolutionAudioInfo } from './evolution-audio'

interface EvolutionItem {
  id: string
  visitLabel: string | null
  content: string
  createdAt: string
}

type FieldConfidenceLevel = 'high' | 'medium' | 'low'

interface PatientProfileView {
  demographics?: { ageYears?: number }
  vitals?: { bloodPressureLabel?: string; systolic?: number; diastolic?: number }
  labs: Array<{ name: string; value: number; unit?: string }>
  medications: Array<{ name: string; dose?: string; frequency?: string }>
  conditions: string[]
  fieldConfidence?: {
    ageYears?: FieldConfidenceLevel
    bloodPressure?: FieldConfidenceLevel
    labs?: Record<string, FieldConfidenceLevel>
    medications?: Record<string, FieldConfidenceLevel>
    conditions?: Record<string, FieldConfidenceLevel>
  }
  lastUpdatedAt?: string
  pendingLabReview?: {
    requiresHumanReview: true
    extractedAt: string
    labs: Array<{ name: string; value: number; unit?: string }>
    redactedSourcePreview?: string
  }
  /** Lo que se extrajo de una evolución y todavía nadie aceptó: no es parte del perfil. */
  pendingEvolutionProposals?: Array<{
    requiresHumanReview: true
    evolutionId: string
    extractedAt: string
    facts: {
      ageYears?: number
      systolic?: number
      diastolic?: number
      labs: Array<{ name: string; value: number; unit?: string }>
      medications: Array<{ name: string; dose?: string; frequency?: string }>
      conditions: string[]
    }
  }>
}

interface ScreeningAssessment {
  criterionNumber: string
  criterionText: string
  kind: 'inclusion' | 'exclusion'
  status: 'pass' | 'fail' | 'unknown'
  reason: string
  sourcePages?: number[]
  /** Dato que falta para resolverlo; de acá sale la guía del estudio. */
  missing?: string[]
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

const CONFIDENCE_STYLES: Record<FieldConfidenceLevel, string> = {
  high: 'bg-emerald-100 text-emerald-800',
  medium: 'bg-amber-100 text-amber-900',
  low: 'bg-alphi-slate/60 text-alphi-muted',
}

const CONFIDENCE_LABELS: Record<FieldConfidenceLevel, string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
}

function ConfidenceBadge({ level }: { level?: FieldConfidenceLevel }) {
  if (!level) return null
  return (
    <span
      className={`ml-2 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${CONFIDENCE_STYLES[level]}`}
      title={`Confianza de extracción: ${CONFIDENCE_LABELS[level]}`}
    >
      {CONFIDENCE_LABELS[level]}
    </span>
  )
}

function ProtocolPageLinks({
  documentId,
  pages,
}: {
  documentId: string | null
  pages?: number[]
}) {
  if (!documentId || !pages?.length) return null
  const unique = [...new Set(pages)].sort((a, b) => a - b).slice(0, 3)
  return (
    <span className="mt-1 block text-[10px]">
      {unique.map((page) => (
        <a
          key={page}
          href={`/api/documents/${encodeURIComponent(documentId)}/page/${page}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mr-2 font-semibold text-alphi-teal hover:underline"
        >
          Ver p.{page} en protocolo
        </a>
      ))}
    </span>
  )
}

/** El código de error que devolvió la ruta, o uno genérico si la respuesta no trae cuerpo legible. */
async function errorCode(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null)
  const code = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null
  return typeof code === 'string' ? code : 'request_failed'
}

const codeOf = (err: unknown): string | null => (err instanceof Error ? err.message : null)

export default function SubjectEvolutionClient({ studyId, subjectId }: SubjectEvolutionClientProps) {
  const [subjectCode, setSubjectCode] = useState<string>('…')
  const [evolutions, setEvolutions] = useState<EvolutionItem[]>([])
  const [profile, setProfile] = useState<PatientProfileView | null>(null)
  const [assessments, setAssessments] = useState<ScreeningAssessment[]>([])
  const [protocolDocumentId, setProtocolDocumentId] = useState<string | null>(null)
  const [specAvailable, setSpecAvailable] = useState(false)
  const [specNotice, setSpecNotice] = useState<string | null>(null)
  /** Las visitas del cronograma del protocolo, con sus procedimientos. */
  const [protocolVisits, setProtocolVisits] = useState<ProtocolVisit[]>([])
  /** Lo guardado de este sujeto no se pudo leer: la ficha lo dice en vez de mostrar un perfil vacío. */
  const [profileUnreadable, setProfileUnreadable] = useState(false)
  const [content, setContent] = useState('')
  // Presente cuando el texto del cuadro salió de un dictado: viaja al registro al guardar.
  const [dictationSource, setDictationSource] = useState<DictationSource | null>(null)
  // La grabación espera acá: sale del equipo recién cuando la persona guarda la evolución.
  // Una grabación por toma (D22); se suben recién cuando la persona guarda la evolución.
  const [dictationRecordings, setDictationRecordings] = useState<Array<DictationRecording & { take: number }>>([])
  // Cuántas tomas se dictaron en este borrador: la grabación de cada una lleva ese número.
  const dictationTakeRef = useRef(0)
  const [audios, setAudios] = useState<Record<string, EvolutionAudioInfo[]>>({})
  const [audioNotice, setAudioNotice] = useState<string | null>(null)
  /** Sube con cada guardado: le avisa al panel de dictado que vuelva al inicio. */
  const [savedCount, setSavedCount] = useState(0)
  const [visitLabel, setVisitLabel] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [piiWarnings, setPiiWarnings] = useState<string[]>([])
  const [labOcrText, setLabOcrText] = useState('')
  const [labBusy, setLabBusy] = useState(false)
  const [proposalBusy, setProposalBusy] = useState(false)

  /** Qué más decir en este estudio para este sujeto: sale de los criterios a revisar. */
  const studyPrompts = useMemo(() => studyDictationPrompts(assessments), [assessments])
  /** La visita del cronograma que coincide con lo escrito en «¿Qué visita es?». Si no señala una sola, ninguna. */
  const protocolVisit = useMemo(() => matchProtocolVisit(visitLabel, protocolVisits), [visitLabel, protocolVisits])

  const loadScreening = useCallback(async () => {
    try {
      const res = await fetch(`/api/studies/${studyId}/subjects/${subjectId}/screening`)
      if (!res.ok) return
      const data = (await res.json()) as {
        profile: PatientProfileView
        assessments: ScreeningAssessment[]
        specAvailable: boolean
        specStatus?: string | null
        specVersion?: number | null
        protocolDocumentId?: string | null
        visits?: ProtocolVisit[]
        profileUnreadable?: boolean
      }
      setProfile(data.profile)
      setAssessments(data.assessments)
      setSpecAvailable(data.specAvailable)
      setSpecNotice(data.specAvailable ? unapprovedSpecNotice(data.specStatus, data.specVersion) : null)
      setProtocolDocumentId(data.protocolDocumentId ?? null)
      setProtocolVisits(data.visits ?? [])
      setProfileUnreadable(data.profileUnreadable === true)
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
        setError('Esta instalación no tiene configurado el cifrado de datos clínicos. No se guardó nada. Avisá a quien administra la plataforma.')
        return
      }
      if (!res.ok) throw new Error('fetch_failed')
      const data = (await res.json()) as { subjectCode: string; evolutions: EvolutionItem[] }
      setSubjectCode(data.subjectCode)
      setEvolutions(data.evolutions)
      // Qué evoluciones tienen grabación. Si esto falla, la lista se muestra igual.
      try {
        const audioRes = await fetch(`/api/studies/${studyId}/subjects/${subjectId}/dictation-audios`)
        if (audioRes.ok) {
          const listing = (await audioRes.json()) as { audios: AudioListingItem[] }
          setAudios(groupAudiosByEvolution(listing.audios))
        }
      } catch {
        setAudios({})
      }
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
          // Los apartados sin dictar se cuentan sobre el texto que se guarda, no sobre el borrador.
          ...(dictationSource
            ? { source: { ...dictationSource, missingBlocks: content.split('\n').filter((line) => line.trimEnd().endsWith(NOT_MENTIONED)).length } }
            : {}),
        }),
      })
      const data = (await res.json()) as { id?: string; piiWarnings?: string[]; error?: string }
      if (res.status === 503) {
        setError('Esta instalación no tiene configurado el cifrado de datos clínicos. No se guardó nada. Avisá a quien administra la plataforma.')
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'save_failed')
      if (data.piiWarnings?.length) setPiiWarnings(data.piiWarnings)
      // La evolución ya está guardada. La grabación va después y, si falla, se avisa: no se pierde el texto.
      setAudioNotice(null)
      if (dictationSource && dictationRecordings.length > 0 && data.id) {
        const uploaded = await uploadRecordingTakes({
          url: `/api/studies/${studyId}/subjects/${subjectId}/evolutions/${data.id}/audio`,
          takes: dictationRecordings,
        })
        setAudioNotice(uploadNotice(uploaded))
      }
      setContent('')
      setDictationSource(null)
      setDictationRecordings([])
      dictationTakeRef.current = 0
      setSavedCount((value) => value + 1)
      setVisitLabel('')
      await loadEvolutions()
    } catch {
      setError('No se pudo guardar la evolución.')
    } finally {
      setSaving(false)
    }
  }

  async function handleLabExtract(e: React.FormEvent) {
    e.preventDefault()
    if (!labOcrText.trim()) return
    setLabBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/studies/${studyId}/subjects/${subjectId}/labs/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: labOcrText.trim() }),
      })
      if (!res.ok) throw new Error(await errorCode(res))
      setLabOcrText('')
      await loadScreening()
    } catch (err) {
      setError(profileWriteErrorMessage(codeOf(err)) ?? 'No se pudieron extraer labs del texto. Verificá el formato.')
    } finally {
      setLabBusy(false)
    }
  }

  async function handleLabConfirm() {
    setLabBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/studies/${studyId}/subjects/${subjectId}/labs/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(await errorCode(res))
      await loadScreening()
    } catch (err) {
      setError(profileWriteErrorMessage(codeOf(err)) ?? 'No se pudo confirmar la revisión de labs.')
    } finally {
      setLabBusy(false)
    }
  }

  async function handleLabReject() {
    setLabBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/studies/${studyId}/subjects/${subjectId}/labs/reject`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(await errorCode(res))
      await loadScreening()
    } catch (err) {
      setError(profileWriteErrorMessage(codeOf(err)) ?? 'No se pudo descartar la revisión de labs.')
    } finally {
      setLabBusy(false)
    }
  }

  async function handleProposal(evolutionId: string, decision: 'confirm' | 'reject') {
    setProposalBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/studies/${studyId}/subjects/${subjectId}/profile/proposals/${evolutionId}/${decision}`, { method: 'POST' })
      // 409: otra persona ya la resolvió. Se recarga y se muestra lo que hay.
      if (!res.ok && res.status !== 409) throw new Error(await errorCode(res))
      await loadScreening()
    } catch (err) {
      setError(
        profileWriteErrorMessage(codeOf(err)) ??
          (decision === 'confirm' ? 'No se pudo aceptar la propuesta. El perfil no cambió.' : 'No se pudo descartar la propuesta.'),
      )
    } finally {
      setProposalBusy(false)
    }
  }

  const pendingProposals = profile?.pendingEvolutionProposals ?? []
  const pendingLabs = profile?.pendingLabReview
  const hasProfileData =
    profile &&
    (profile.demographics?.ageYears ||
      profile.vitals?.bloodPressureLabel ||
      profile.labs.length > 0 ||
      profile.medications.length > 0 ||
      profile.conditions.length > 0 ||
      pendingLabs?.requiresHumanReview)

  const fc = profile?.fieldConfidence

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
          <p className="text-sm text-alphi-muted">Evolución clínica — screening + labs OCR con revisión humana</p>
        </div>
      </div>

      {/* Arriba de todo: lo que se ve vacío más abajo está vacío porque no se pudo leer. */}
      {profileUnreadable ? <ProfileUnreadableNotice /> : null}

      <form onSubmit={handleSave} className="space-y-4 rounded-lg border border-alphi-border bg-alphi-slate/20 p-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-alphi-muted">Nueva evolución</h3>

        {/* Dos columnas: a la izquierda se graba, se revisa y se guarda; a la derecha, la guía, siempre a la vista. */}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-4">
        <DictationPanel
          resetSignal={savedCount}
          onDraft={(draft, source, recording) => {
            // Lo dictado va al mismo cuadro donde se escribe. Si ya había texto, lo nuevo se suma
            // a su apartado (D16): no se pisa nada de lo que ya estaba.
            setContent((previous) => mergeDictationAddition(previous, draft))
            setDictationSource((previous) =>
              previous
                ? {
                    ...source,
                    durationSec: previous.durationSec + source.durationSec,
                    corrections: previous.corrections + source.corrections,
                    repetitions: previous.repetitions + source.repetitions,
                  }
                : source,
            )
            // Una grabación por toma, hasta el tope, con el número de la toma dictada (D22).
            dictationTakeRef.current += 1
            const takeNumber = dictationTakeRef.current
            setDictationRecordings((previous) => addRecordingTake(previous, recording, takeNumber))
          }}
          onDiscard={() => {
            setContent('')
            setDictationSource(null)
            setDictationRecordings([])
            dictationTakeRef.current = 0
          }}
        />

        <div>
          <label htmlFor="content" className="alphi-label mb-1 block">
            Evolución clínica
          </label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={Math.min(22, Math.max(8, content.split('\n').length + 2))}
            placeholder="Escribila acá o dictala con el micrófono de arriba: lo dictado aparece en este cuadro para que lo revises antes de guardar."
            className="w-full rounded-lg border border-alphi-border bg-white px-3 py-2 text-sm leading-relaxed"
          />
          {dictationSource ? (
            <p className="mt-1 text-xs font-medium text-alphi-amber">Texto generado a partir de un dictado. Comparalo con lo que dijiste antes de guardar.</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <label htmlFor="visitLabel" className="alphi-label mb-1 block">
              ¿Qué visita es? (opcional)
            </label>
            <input
              id="visitLabel"
              type="text"
              value={visitLabel}
              onChange={(e) => setVisitLabel(e.target.value)}
              placeholder="Selección, Visita 2, Basal…"
              list={protocolVisits.length > 0 ? 'protocol-visits' : undefined}
              className="w-64 max-w-full rounded-lg border border-alphi-border bg-white px-3 py-2 text-sm"
            />
            {protocolVisits.length > 0 ? (
              <datalist id="protocol-visits">
                {protocolVisits.map((visit, index) => (
                  <option key={`${index}-${visit.name}`} value={visit.name}>
                    {visit.label ?? ''}
                  </option>
                ))}
              </datalist>
            ) : null}
            <p className="mt-1 max-w-sm text-xs text-alphi-muted">
              Sirve para encontrarla después: aparece junto a la fecha en el historial. No forma parte del texto clínico.
            </p>
          </div>
          <button type="submit" disabled={saving || !content.trim()} className="alphi-btn-primary px-6 py-3 text-base">
            {saving ? 'Guardando…' : 'Guardar evolución'}
          </button>
        </div>
        </div>
        <DictationGuide
          studyPrompts={studyPrompts}
          unapprovedProtocol={specNotice !== null}
          visit={protocolVisit}
          visitsAvailable={protocolVisits.length > 0}
        />
        </div>
      </form>

      <form
        onSubmit={handleLabExtract}
        className="space-y-3 rounded-lg border border-alphi-border bg-white p-4"
      >
        <h3 className="text-sm font-bold uppercase tracking-wide text-alphi-muted">
          Labs OCR (requiere confirmación)
        </h3>
        <p className="text-xs text-alphi-muted">
          Pegá texto de un informe de laboratorio. Los analitos detectados quedan pendientes hasta que
          confirmes — no se aplican al perfil automáticamente.
        </p>
        <textarea
          value={labOcrText}
          onChange={(e) => setLabOcrText(e.target.value)}
          rows={5}
          placeholder={'Paciente: …\nHbA1c: 8,2 %\nGlucosa en ayunas: 142 mg/dL'}
          className="w-full rounded-lg border border-alphi-border px-3 py-2 text-sm leading-relaxed"
        />
        <button
          type="submit"
          disabled={labBusy || !labOcrText.trim() || Boolean(pendingLabs?.requiresHumanReview)}
          className="alphi-btn-secondary text-sm"
        >
          {labBusy ? 'Extrayendo…' : 'Extraer labs (pendiente revisión)'}
        </button>
      </form>

      {pendingLabs?.requiresHumanReview && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">Revisión humana requerida (URS-007)</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-950">
            {pendingLabs.labs.map((lab) => (
              <li key={lab.name}>
                {lab.name}: {lab.value}
                {lab.unit ? ` ${lab.unit}` : ''}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleLabConfirm()}
              disabled={labBusy}
              className="alphi-btn-primary text-sm"
            >
              Confirmar y aplicar al perfil
            </button>
            <button
              type="button"
              onClick={() => void handleLabReject()}
              disabled={labBusy}
              className="rounded-lg border border-amber-400 px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-100"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {pendingProposals.map((proposal) => (
        <div key={proposal.evolutionId} className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">Propuesta para el perfil: falta que una persona la revise</p>
          <p className="mt-1 text-xs text-amber-900">
            Esto se leyó automáticamente en una evolución. Todavía no forma parte del perfil ni del screening. Comparalo con la evolución antes de aceptar.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-950">
            {proposal.facts.ageYears !== undefined ? <li>Edad: {proposal.facts.ageYears} años</li> : null}
            {bloodPressureProposalLabel(proposal.facts) ? <li>{bloodPressureProposalLabel(proposal.facts)}</li> : null}
            {proposal.facts.labs.map((lab) => (
              <li key={`lab-${lab.name}`}>
                Laboratorio · {lab.name}: {lab.value}
                {lab.unit ? ` ${lab.unit}` : ''}
              </li>
            ))}
            {proposal.facts.medications.map((med) => (
              <li key={`med-${med.name}`}>
                Medicación · {med.name}
                {med.dose ? ` ${med.dose}` : ''}
                {med.frequency ? ` ${med.frequency}` : ''}
              </li>
            ))}
            {proposal.facts.conditions.map((condition) => (
              <li key={`cond-${condition}`}>Condición · {condition}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleProposal(proposal.evolutionId, 'confirm')}
              disabled={proposalBusy}
              className="alphi-btn-primary text-sm"
            >
              Aceptar y sumar al perfil
            </button>
            <button
              type="button"
              onClick={() => void handleProposal(proposal.evolutionId, 'reject')}
              disabled={proposalBusy}
              className="rounded-lg border border-amber-400 px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-100"
            >
              Descartar
            </button>
          </div>
        </div>
      ))}

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

      {audioNotice ? (
        <p role="status" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{audioNotice}</p>
      ) : null}

      {error && (
        <p className="rounded-lg border border-alphi-rose/30 bg-alphi-rose/10 px-4 py-2 text-sm text-alphi-rose">{error}</p>
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
                  <dt className="text-xs text-alphi-muted">
                    Edad
                    <ConfidenceBadge level={fc?.ageYears} />
                  </dt>
                  <dd>{profile.demographics.ageYears} años</dd>
                </div>
              )}
              {profile?.vitals?.bloodPressureLabel && (
                <div>
                  <dt className="text-xs text-alphi-muted">
                    Presión arterial
                    <ConfidenceBadge level={fc?.bloodPressure} />
                  </dt>
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
                        <ConfidenceBadge level={fc?.labs?.[lab.name.toLowerCase()]} />
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
                        <ConfidenceBadge level={fc?.medications?.[m.name.toLowerCase()]} />
                      </div>
                    ))}
                  </dd>
                </div>
              )}
              {profile && profile.conditions.length > 0 && (
                <div>
                  <dt className="text-xs text-alphi-muted">Condiciones / notas</dt>
                  <dd>
                    {profile.conditions.map((c) => (
                      <span key={c} className="mr-2 inline-block">
                        {c}
                        <ConfidenceBadge level={fc?.conditions?.[c.toLowerCase()]} />
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          )}
          <p className="mt-3 text-[10px] text-alphi-muted">
            Alta = heurística + LLM coinciden · Media = solo LLM · Baja = solo heurística
          </p>
        </section>

        <section className="rounded-lg border border-alphi-border bg-white p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-alphi-muted">
            Screening (orientativo)
          </h3>
          {!specAvailable ? (
            <p className="text-sm text-alphi-muted">
              Extraé y aprobá el study spec del protocolo para evaluar criterios automáticamente.
            </p>
          ) : (
            <>
            {/* El aviso va primero y siempre: un borrador sin revisar también puede haber omitido todos los criterios. */}
            {specNotice ? (
              <p
                role="note"
                className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
              >
                {specNotice}
              </p>
            ) : null}
            {assessments.length === 0 ? (
              <p className="text-sm text-alphi-muted">Sin criterios en el spec del estudio.</p>
            ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {assessments.map((a) => (
                <li
                  key={`${a.kind}-${a.criterionNumber}`}
                  className={`rounded border px-3 py-2 text-xs ${STATUS_STYLES[a.status]}`}
                >
                  <p className="font-semibold">
                    {a.kind === 'inclusion' ? 'Inclusión' : 'Exclusión'} #{a.criterionNumber} — {criterionStatusLabel(a.kind, a.status)}
                  </p>
                  <p className="mt-1 opacity-80">{a.reason}</p>
                  <ProtocolPageLinks documentId={protocolDocumentId} pages={a.sourcePages} />
                </li>
              ))}
            </ul>
            )}
            </>
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
                <EvolutionAudios studyId={studyId} subjectId={subjectId} audios={audios[evo.id] ?? []} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
