'use client'

import Link from 'next/link'
import { Send } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { AnswerContent } from '../chat/answer-content'
import { sendChatQuestion } from '../chat/chat-api'
import { ConfidenceBadge } from '../chat/confidence-badge'
import type { ChatResponse, Evidence } from '../chat/types'

interface StudyOption {
  id: string
  label: string
}

function pageRange(evidence: Evidence): string {
  if (evidence.pageStart === null) return 'sin página'
  if (evidence.pageEnd === null || evidence.pageEnd === evidence.pageStart) return `pág. ${evidence.pageStart}`
  return `pág. ${evidence.pageStart}–${evidence.pageEnd}`
}

/**
 * Pregunta rápida al protocolo desde el Inicio. Usa el mismo endpoint que la
 * pantalla de chat: mismas barreras, misma auditoría y la conversación queda
 * guardada en el estudio elegido.
 */
export function ProtocolIntelligence({ studies }: { studies: StudyOption[] }) {
  const formId = useId()
  const [studyId, setStudyId] = useState(studies[0]?.id ?? '')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [answer, setAnswer] = useState<ChatResponse | null>(null)
  const [answeredStudyId, setAnsweredStudyId] = useState<string | null>(null)

  async function ask(event: FormEvent) {
    event.preventDefault()
    const text = question.trim()
    if (!text || !studyId || busy) return
    setBusy(true)
    setFailed(false)
    try {
      const response = await sendChatQuestion({ studyId, question: text })
      setAnswer(response)
      setAnsweredStudyId(studyId)
    } catch {
      setAnswer(null)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const references = answer?.evidences.slice(0, 4) ?? []

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={ask} className="flex flex-col gap-2">
        <label className="text-sm font-semibold text-os-ink" htmlFor={`${formId}-study`}>
          Estudio
        </label>
        <select
          id={`${formId}-study`}
          value={studyId}
          onChange={(event) => setStudyId(event.target.value)}
          className="min-h-11 w-full rounded-lg border border-alphi-border bg-white px-3 text-sm text-os-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
        >
          {studies.map((study) => (
            <option key={study.id} value={study.id}>
              {study.label}
            </option>
          ))}
        </select>
        <label className="text-sm font-semibold text-os-ink" htmlFor={`${formId}-question`}>
          Pregunta
        </label>
        <div className="flex gap-2">
          <input
            id={`${formId}-question`}
            value={question}
            maxLength={2000}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="¿Qué evaluaciones requiere la visita 3?"
            className="min-h-11 w-full min-w-0 rounded-lg border border-alphi-border bg-white px-3 text-sm text-os-ink placeholder:text-os-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
          />
          <button
            type="submit"
            disabled={busy || !question.trim()}
            aria-label="Preguntar al protocolo"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-os-accent text-white hover:bg-os-accentdim disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
          >
            <Send aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {busy ? <p className="text-sm text-os-subtle">Buscando en el protocolo…</p> : null}
        {failed ? (
          <p className="rounded-xl bg-[#FBE3E7] px-4 py-3 text-sm text-[#8C1D3A]">
            No se pudo obtener la respuesta. Probá de nuevo o abrí la pantalla de consulta del estudio.
          </p>
        ) : null}
        {answer && !busy ? (
          <div className="rounded-xl bg-os-ground p-4">
            <div className="mb-2">
              <ConfidenceBadge confidence={answer.confidence} />
            </div>
            <div className="text-sm leading-relaxed text-os-ink">
              <AnswerContent text={answer.answer} evidences={answer.evidences} onFootnoteClick={() => undefined} />
            </div>
            {references.length > 0 ? (
              <div className="mt-3">
                <p className="text-xs font-semibold text-os-subtle">Referencias del protocolo</p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {references.map((evidence) => (
                    <li key={evidence.chunkId} className="rounded-lg border border-alphi-border bg-white px-2.5 py-1 text-xs text-os-ink">
                      {evidence.sectionTitle ?? evidence.documentName ?? 'Documento'} ({pageRange(evidence)})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {answeredStudyId ? (
              <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold">
                <Link href={`/studies/${answeredStudyId}/chat`} className="text-os-accentdim underline">
                  Abrir conversación
                </Link>
                <Link href={`/studies/${answeredStudyId}/documents`} className="text-os-accentdim underline">
                  Ver protocolo
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="text-xs text-os-subtle">Responde solo desde los documentos cargados del estudio. Verificá siempre con el original.</p>
    </div>
  )
}
